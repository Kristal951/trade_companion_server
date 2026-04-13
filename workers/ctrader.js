import { Worker } from "bullmq";
import IORedis from "ioredis";

import UserModel from "../models/User.js";
import { TradeSignal } from "../models/TradeSignal.js";

import { decryptText } from "../utils/ctraderCrypto.js";
import {
  buildMultiTPOrders,
  normalizeSymbol,
  refreshCtraderTokenIfNeeded,
} from "../utils/ctraderApi.js";

import { redisPublisher } from "../utils/redis.js";
import { ctraderClient } from "../services/ctraderClient.js";
import { SymbolService } from "../services/symbol.js";

/* =========================
   SHARED CONNECTION (IMPORTANT)
========================= */

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

/* =========================
   SAFE WORKER
========================= */

export const createCtraderWorker = () =>
  new Worker(
    "ctrader-trades",
    async (job) => {
      const { userId, signal } = job.data;

      console.log(`[JOB START] user=${userId} signal=${signal?._id}`);

      if (
        !signal?._id ||
        !signal?.instrument ||
        !signal?.type ||
        !signal?.volume
      ) {
        throw new Error("Invalid signal data");
      }

      /* =========================
         ATOMIC SAFETY CHECK (PREVENT DOUBLE EXECUTION)
      ========================= */

      const updated = await TradeSignal.findOneAndUpdate(
        { _id: signal._id, status: { $ne: "EXECUTED" } },
        { $set: { status: "PROCESSING" } },
        { new: true },
      );

      if (!updated) {
        console.log(`[SKIP] Already processed signal=${signal._id}`);
        return;
      }

      /* =========================
         USER LOAD
      ========================= */

      const user = await UserModel.findById(userId).select(
        "+cTraderConfig.accessTokenEnc +cTraderConfig.refreshTokenEnc +cTraderConfig.accountId +cTraderConfig.isConnected",
      );

      if (!user) throw new Error("User not found");

      const cfg = user.cTraderConfig;

      if (!cfg?.isConnected) {
        await TradeSignal.findByIdAndUpdate(signal._id, {
          status: "FAILED",
          executionDetails: { reason: "cTrader not connected" },
        });
        return;
      }

      /* =========================
         TOKEN HANDLING
      ========================= */

      let accessToken = decryptText(cfg.accessTokenEnc);
      const refreshToken = decryptText(cfg.refreshTokenEnc);

      try {
        const refreshed = await refreshCtraderTokenIfNeeded({
          userId,
          accessToken,
          refreshToken,
          expiresAt: cfg.expiresAt,
        });

        accessToken = refreshed.accessToken;
      } catch (err) {
        await TradeSignal.findByIdAndUpdate(signal._id, {
          status: "FAILED",
          executionDetails: { reason: "Token refresh failed" },
        });

        throw err;
      }

      /* =========================
         AUTH CHECK (FIXED PER JOB)
      ========================= */

      const authRes = await ctraderClient.send(2102, "ProtoOAAccountAuthReq", {
        ctidTraderAccountId: Number(cfg.accountId),
        accessToken,
      });

      if (authRes?.payloadType !== 2103) {
        throw new Error("Account auth failed");
      }

      /* =========================
         SYMBOL RESOLUTION (OPTIMIZED)
      ========================= */

      const symbolService = new SymbolService(Number(cfg.accountId));

      const symbolList = await ctraderClient.getSymbols(Number(cfg.accountId));

      const target = normalizeSymbol(signal.instrument);

      const brokerSymbol = symbolList.find(
        (s) => normalizeSymbol(s.symbolName) === target,
      );

      if (!brokerSymbol) {
        throw new Error(`${target} not found in broker list`);
      }

      const symbolSpecs = await symbolService.getSymbolById(
        brokerSymbol.symbolId,
      );

      /* =========================
         ORDER BUILD
      ========================= */

      const orders = buildMultiTPOrders({
        signal,
        symbol: symbolSpecs,
      });

      const results = [];

      for (const [index, params] of orders.entries()) {
        console.log(
          `📡 ORDER: Symbol=${brokerSymbol.symbolId} Vol=${params.volume}`,
        );

        const orderPayload = {
          ctidTraderAccountId: Number(cfg.accountId),
          symbolId: Number(brokerSymbol.symbolId),
          orderType: 1,
          tradeSide: signal.type.toUpperCase() === "BUY" ? 1 : 2,
          volume: params.volume,
          relativeStopLoss: params.relativeStopLoss,
          relativeTakeProfit: params.relativeTakeProfit,
          comment: `SignalID:${signal._id}-TP${index + 1}`,
        };

        const response = await Promise.race([
          ctraderClient.send(2106, "ProtoOANewOrderReq", orderPayload),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Trade timeout")), 12000),
          ),
        ]);

        if (response?.payloadType === 2132) {
          throw new Error(
            `Order rejected: ${response.payload?.description || "Unknown"}`,
          );
        }

        if (response?.payloadType !== 2126) {
          throw new Error(`Unexpected response: ${response?.payloadType}`);
        }

        results.push(response.payload);
      }

      /* =========================
         SAVE RESULT
      ========================= */

      const mainOrder = results[0];

      await TradeSignal.findByIdAndUpdate(signal._id, {
        status: "EXECUTED",
        orderId: mainOrder.order.orderId,
        executionDetails: { allOrders: results },
        filledPrice: mainOrder.order.executionPrice,
      });

      /* =========================
         PUB/SUB EVENT
      ========================= */

      await redisPublisher.publish(
        "trade_events",
        JSON.stringify({
          userId,
          type: "TRADE_EXECUTED",
          data: {
            signalId: signal._id,
            orderIds: results.map((r) => r.order.orderId),
          },
        }),
      );

      return {
        success: true,
        orders: results.length,
      };
    },
    {
      connection,
      concurrency: 5,
    },
  );
