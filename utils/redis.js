import { createClient } from "redis";
import { getLivePrice } from "../services/marketDataServices.js";
import { getIO } from "../sockets/io.js";

// --------------------
// Redis Clients

export const redisPublisher = createClient({
  url: process.env.REDIS_URL,
});

export const redisSubscriber = createClient({
  url: process.env.REDIS_URL,
});

// --------------------
// Redis Events
// --------------------
redisPublisher.on("connect", () => {
  console.log("🔌 Redis Publisher connecting...");
});

redisPublisher.on("ready", () => {
  console.log("✅ Redis Publisher ready");
});

redisPublisher.on("error", (err) => {
  console.error("❌ Redis Publisher error:", err);
});

redisSubscriber.on("connect", () => {
  console.log("🔌 Redis Subscriber connecting...");
});

redisSubscriber.on("ready", () => {
  console.log("✅ Redis Subscriber ready");
});

redisSubscriber.on("error", (err) => {
  console.error("❌ Redis Subscriber error:", err);
});

// --------------------
// Init Redis
// --------------------
export const initRedis = async () => {
  // --------------------
  console.log("🔥 ENV REDIS_URL =", process.env.REDIS_URL);
  console.log("connecting redis...");

  if (!redisPublisher.isOpen) {
    await redisPublisher.connect();
  }

  if (!redisSubscriber.isOpen) {
    await redisSubscriber.connect();
  }

  // Subscribe AFTER connection is ready
  await redisSubscriber.subscribe("trade_events", async (message) => {
    let event;

    try {
      event = JSON.parse(message);
    } catch (err) {
      console.error("❌ Invalid Redis message:", message);
      return;
    }

    const { instrument, entryPrice, lotSize, userId, direction } = event;

    try {
      const priceData = await getLivePrice(instrument);
      const currentPrice = priceData?.price;

      let pnl = 0;

      if (currentPrice && entryPrice) {
        const multiplier = 100000;

        if (direction === "sell") {
          pnl = (entryPrice - currentPrice) * lotSize * multiplier;
        } else {
          pnl = (currentPrice - entryPrice) * lotSize * multiplier;
        }
      }

      const io = getIO();

      io.to(userId).emit("trade_update", {
        ...event,
        currentPrice,
        pnl,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("❌ Error processing trade event:", err);
    }
  });
};

// --------------------
// Symbol Key Helper
// --------------------
export const getSymbolKey = (symbolId) => `ctrader:symbol:${symbolId}`;

// --------------------
// Broker Symbol Specs (Cached)
// --------------------
export async function getBrokerSymbolSpecs(ctraderClient, symbolId) {
  const key = getSymbolKey(symbolId);

  const cached = await redisPublisher.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  const symbol = await ctraderClient.getSymbolById(symbolId);

  const specs = {
    symbolId: symbol.symbolId,
    digits: symbol.digits,
    tickSize: symbol.tickSize,
    volumeStep: symbol.volumeStep,
    minVolume: symbol.minVolume,
    maxVolume: symbol.maxVolume,
    contractSize: symbol.contractSize,
  };

  await redisPublisher.setEx(key, 3600, JSON.stringify(specs));

  return specs;
}
