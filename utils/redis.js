import IORedis from "ioredis";
import { getLivePrice } from "../services/marketDataServices.js";
import { getIO } from "../sockets/io.js";

// =========================
// ✅ Redis Connection Setup
// =========================

// ioredis connects automatically upon instantiation.
// We set maxRetriesPerRequest to null for compatibility with BullMQ.
const connectionOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  reconnectOnError: (err) => {
    const targetError = "READONLY";
    if (err.message.includes(targetError)) return true;
    return false;
  },
};

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn("⚠️ REDIS_URL is missing. Redis features will fail.");
}

// Client for general GET/SET operations (Caching)
export const redis = new IORedis(REDIS_URL, connectionOptions);

// Client for Publishing messages
export const redisPublisher = new IORedis(REDIS_URL, connectionOptions);

// Client for Subscribing to channels
export const redisSubscriber = new IORedis(REDIS_URL, connectionOptions);

// =========================
// ✅ Status & Event Logging
// =========================

const logEvents = (client, name) => {
  client.on("connect", () => console.log(`🔌 Redis ${name} connecting...`));
  client.on("ready", () => console.log(`✅ Redis ${name} ready`));
  client.on("error", (err) =>
    console.error(`❌ Redis ${name} error:`, err.message),
  );
};

logEvents(redis, "Main");
logEvents(redisPublisher, "Publisher");
logEvents(redisSubscriber, "Subscriber");

// =========================
// ✅ Initialization Logic
// =========================

let initialized = false;

export const initRedis = async () => {
  if (initialized) return;

  // Wait for the subscriber to be ready before calling .subscribe()
  if (redisSubscriber.status !== "ready") {
    await new Promise((resolve) => {
      redisSubscriber.once("ready", resolve);
    });
  }

  try {
    await redisSubscriber.subscribe("trade_events");
    console.log("📡 Subscribed to trade_events");

    redisSubscriber.on("message", async (channel, message) => {
      if (channel === "trade_events") {
        await handleTradeEvent(message);
      }
    });

    initialized = true;
  } catch (err) {
    console.error("❌ Redis Init Error:", err.message);
  }
};

// =========================
// ✅ Trade Event Handler
// =========================

async function handleTradeEvent(message) {
  let event;
  try {
    event = JSON.parse(message);
  } catch (err) {
    return console.error("❌ Invalid JSON in Redis message");
  }

  const { instrument, entryPrice, lotSize, userId, direction } = event;

  try {
    // Get live price to calculate floating PnL for the real-time UI
    const priceData = await getLivePrice(instrument);
    const currentPrice = priceData?.price;

    let pnl = 0;
    if (currentPrice && entryPrice) {
      // Note: In production, fetch actual contractSize from getBrokerSymbolSpecs
      const multiplier = 100000;
      pnl =
        direction.toLowerCase() === "sell"
          ? (entryPrice - currentPrice) * lotSize * multiplier
          : (currentPrice - entryPrice) * lotSize * multiplier;
    }

    const io = getIO();
    if (io) {
      io.to(userId).emit("trade_update", {
        ...event,
        currentPrice,
        pnl: Number(pnl.toFixed(2)),
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    console.error("❌ Error processing trade event:", err.message);
  }
}

// =========================
// ✅ Helper Methods (Caching)
// =========================

export const getSymbolKey = (symbolId) => `ctrader:symbol:${symbolId}`;

export async function getBrokerSymbolSpecs(ctraderClient, symbolId) {
  const key = getSymbolKey(symbolId);

  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

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

  // Cache specs for 1 hour
  await redis.set(key, JSON.stringify(specs), "EX", 3600);
  return specs;
}
