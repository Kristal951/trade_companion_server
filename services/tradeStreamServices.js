import { getIO } from "../sockets/io.js";
import { getLivePrice } from "./marketDataServices.js";

/* =========================
   GLOBAL STATE
========================= */

// Active trades (tradeId → trade)
const activeTrades = new Map();

// Active instrument streams
const activeStreams = new Map();

// Price cache (shared across system)
const priceCache = new Map();

/* =========================
   PNL CALCULATION
========================= */

const calculatePnL = (trade, price) => {
  const diff = price - trade.entryPrice;

  switch (trade.assetType) {
    case "forex":
      return diff * trade.lotSize * 100000;

    case "crypto":
      return diff * trade.lotSize;

    case "index":
      return diff * trade.lotSize * 10;

    case "gold":
      return diff * trade.lotSize * 100;

    default:
      return diff * trade.lotSize;
  }
};

/* =========================
   CLOSE TRADE
========================= */

const closeTrade = (trade, price, pnl, reason) => {
  const io = getIO();

  io.to(trade.userId).emit("trade:closed", {
    tradeId: trade._id,
    exitPrice: price,
    pnl,
    reason,
  });

  activeTrades.delete(trade._id);
};

/* =========================
   TRADE UPDATE ENGINE
   (NO SETINTERVAL HERE ❌)
========================= */

export const updateTradesForInstrument = (instrument, price) => {
  const io = getIO();

  for (const [tradeId, trade] of activeTrades.entries()) {
    if (trade.instrument !== instrument) continue;

    const pnl = calculatePnL(trade, price);

    const updatedTrade = {
      ...trade,
      currentPrice: price,
      pnl,
    };

    activeTrades.set(tradeId, updatedTrade);

    // 🔥 real-time update
    io.to(trade.userId).emit("trade:updated", {
      tradeId,
      currentPrice: price,
      pnl,
    });

    // 🚨 EXIT CONDITIONS
    if (pnl >= trade.takeProfit) {
      closeTrade(trade, price, pnl, "TP_HIT");
    }

    if (pnl <= -trade.stopLoss) {
      closeTrade(trade, price, pnl, "SL_HIT");
    }
  }
};

/* =========================
   INSTRUMENT STREAM ENGINE
========================= */

export const startInstrumentStream = (instrument) => {
  const io = getIO();
  if (activeStreams.has(instrument)) return;

  const interval = setInterval(async () => {
    try {
      const data = await getLivePrice(instrument);

      if (!data?.price) return;

      const price = data.price;

      // 💾 cache latest price
      priceCache.set(instrument, price);

      // 📡 emit to frontend
      io.to(`instrument:${instrument}`).emit("price_update", {
        instrument,
        price,
        isMock: data.isMock,
        timestamp: Date.now(),
      });

      // ⚡ trigger trade updates instantly
      updateTradesForInstrument(instrument, price);
    } catch (err) {
      console.error(`Stream error for ${instrument}:`, err);
    }
  }, 1000); // 1s real-time feel

  activeStreams.set(instrument, interval);
};

/* =========================
   STOP STREAM
========================= */

export const stopInstrumentStream = (instrument) => {
  const interval = activeStreams.get(instrument);

  if (interval) {
    clearInterval(interval);
    activeStreams.delete(instrument);
  }
};

/* =========================
   OPEN TRADE
========================= */

export const openTrade = (trade) => {
  const io = getIO();

  activeTrades.set(trade._id, trade);

  io.to(trade.userId).emit("trade:opened", {
    tradeId: trade._id,
    ...trade,
  });

  // 🚀 ensure instrument stream is running
  startInstrumentStream(trade.instrument);
};

/* =========================
   OPTIONAL: GET CACHE PRICE
========================= */

export const getCachedPrice = (instrument) => {
  return priceCache.get(instrument) || null;
};
