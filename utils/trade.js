import Trade from "../models/Trade.js";
import { TradeSignal } from "../models/TradeSignal.js";
import { startInstrumentStream } from "../services/tradeStreamServices.js";
import { getIO } from "../sockets/io.js";

export const executeSignal = async (signalId, userId, entryPrice) => {
  const io = getIO();

  const signal = await TradeSignal.findById(signalId);
  if (!signal) throw new Error("Signal not found");

  const trade = await Trade.create({
    userId,
    signalId,
    instrument: signal.instrument,
    type: signal.type,
    entryPrice,
    currentPrice: entryPrice,
    lotSize: signal.lotSize || 1,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfits?.[0],
    status: "OPEN",
  });

  io.to(userId).emit("trade:opened", trade);

  startInstrumentStream(signal.instrument);

  return trade;
};

export const updateTrade = async (tradeId, price, pnl) => {
  const io = getIO();
  const trade = await Trade.findByIdAndUpdate(
    tradeId,
    {
      currentPrice: price,
      pnl,
      status: "ACTIVE",
    },
    { new: true },
  );

  if (!trade) return;

  io.to(trade.userId).emit("trade:updated", {
    tradeId,
    currentPrice: price,
    pnl,
  });

  return trade;
};

export const closeTrade = async (tradeId, price, pnl, reason) => {
  const io = getIO();
  const trade = await Trade.findByIdAndUpdate(
    tradeId,
    {
      currentPrice: price,
      pnl,
      status: "CLOSED",
      closedAt: new Date(),
      closedBecause: reason,
    },
    { new: true },
  );

  if (!trade) return;

  io.to(trade.userId).emit("trade:closed", {
    tradeId,
    exitPrice: price,
    pnl,
    reason,
  });

  return trade;
};
