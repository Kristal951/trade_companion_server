import { Worker } from "bullmq";
import IORedis from "ioredis";
import UserModel from "../models/User.js";
import { decryptText } from "../utils/ctraderCrypto.js";
import {
  buildMultiTPOrders,
  normalizeSymbol,
  refreshCtraderTokenIfNeeded,
} from "../utils/ctraderApi.js";
import { TradeSignal } from "../models/TradeSignal.js";
import { redisPublisher } from "../utils/redis.js";
import { ctraderClient } from "../services/ctraderClient.js";
import { SymbolService } from "../services/symbol.js";

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

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

      const existing = await TradeSignal.findById(signal._id).lean();
      if (existing?.orderId || existing?.status === "EXECUTED") {
        console.log(`[SKIP] Already executed signal=${signal._id}`);
        return;
      }

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

      await TradeSignal.findOneAndUpdate(
        { _id: signal._id, status: { $ne: "EXECUTED" } },
        { $set: { status: "PROCESSING" } },
      );

      try {
        if (!ctraderClient || !ctraderClient.connected) {
          throw new Error("cTrader client not ready");
        }

        if (!ctraderClient.isAccountAuthenticated) {
          const authRes = await ctraderClient.send(
            2102,
            "ProtoOAAccountAuthReq",
            {
              ctidTraderAccountId: Number(cfg.accountId),
              accessToken,
            },
          );
          if (authRes?.payloadType !== 2103) {
            throw new Error("Account auth failed in worker");
          }
          ctraderClient.isAccountAuthenticated = true;
        }

        const symbolList = await ctraderClient.getSymbols(
          Number(cfg.accountId),
        );
        const target = normalizeSymbol(signal.instrument);
        const brokerSymbol = symbolList.find(
          (s) => normalizeSymbol(s.symbolName) === target,
        );

        if (!brokerSymbol) {
          throw new Error(`${target} not found in broker list`);
        }

        const symbolService = new SymbolService(Number(cfg.accountId));
        const symbolSpecs = await symbolService.getSymbolById(
          brokerSymbol.symbolId,
        );
        console.log(symbolSpecs, 'symbolSpecs', brokerSymbol);

        const orders = buildMultiTPOrders({ signal, symbol: symbolSpecs });
        const results = [];

        for (const [index, params] of orders.entries()) {
          // let finalVolume = params.volume;
         console.log(`📡 SENDING ORDER: Symbol=${brokerSymbol.symbolId} Vol=${params.volume} Type=${signal.type}`);

          const orderPayload = {
            ctidTraderAccountId: Number(cfg.accountId),
            symbolId: Number(brokerSymbol.symbolId),
            orderType: 1,
            tradeSide: signal.type.toUpperCase() === "BUY" ? 1 : 2,
            volume: params.volume,
            relativeStopLoss: params.relativeStopLoss,
            relativeTakeProfit: params.relativeTakeProfit,
            comment: `SignalID: ${signal._id} TP#${index + 1}`,
          };

          const response = await Promise.race([
            ctraderClient.send(2106, "ProtoOANewOrderReq", orderPayload),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Trade timeout")), 12000),
            ),
          ]);

          if (response?.payloadType === 2132) {
            throw new Error(
              `Order rejected: ${response.payload?.description || "Unknown error"}`,
            );
          }

          if (response?.payloadType !== 2126) {
            throw new Error(
              `Unexpected response type: ${response?.payloadType}`,
            );
          }

          results.push(response.payload);
        }

        const mainOrder = results[0];

        await TradeSignal.findByIdAndUpdate(signal._id, {
          status: "EXECUTED",
          orderId: mainOrder.order.orderId,
          executionDetails: { allOrders: results },
          filledPrice: mainOrder.order.executionPrice,
        });

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

        return { success: true, count: results.length };
      } catch (err) {
        console.error(`[TRADE ERROR] user=${userId} signal=${signal._id}`, err);

        await TradeSignal.findByIdAndUpdate(signal._id, {
          status: "FAILED",
          executionDetails: { error: err.message },
        });

        const isRetryable = /timeout|disconnected|ECONNRESET/.test(err.message);
        if (isRetryable) throw err;
      }
    },
    { connection, concurrency: 5 },
  );
