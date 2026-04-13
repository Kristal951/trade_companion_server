import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

// =========================
// ENV CHECK
// =========================

if (!process.env.REDIS_URL) {
  throw new Error("❌ REDIS_URL is missing in environment variables");
}

// =========================
// REDIS CONFIG
// =========================

const redisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// =========================
// SINGLE RESPONSIBILITY CONNECTIONS
// =========================

// Queue connection
const queueConnection = new IORedis(process.env.REDIS_URL, redisOptions);

// Events connection (must be separate)
const eventsConnection = new IORedis(process.env.REDIS_URL, redisOptions);

// =========================
// QUEUE
// =========================

export const ctraderQueue = new Queue("ctrader-trades", {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});

// =========================
// QUEUE EVENTS
// =========================

export const ctraderQueueEvents = new QueueEvents(
  "ctrader-trades",
  {
    connection: eventsConnection,
  },
);

// =========================
// SAFETY EVENTS (IMPORTANT)
// =========================

ctraderQueueEvents.on("connect", () => {
  console.log("🔌 QueueEvents connected");
});

ctraderQueueEvents.on("ready", () => {
  console.log("✅ QueueEvents ready");
});

ctraderQueueEvents.on("error", (err) => {
  console.error("❌ QueueEvents error:", err);
});

ctraderQueueEvents.on("stalled", ({ jobId }) => {
  console.warn(`[QUEUE STALLED] jobId=${jobId}`);
});

ctraderQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`[QUEUE FAILED] jobId=${jobId}`, failedReason);
});

ctraderQueueEvents.on("completed", ({ jobId }) => {
  console.log(`[QUEUE COMPLETED] jobId=${jobId}`);
});