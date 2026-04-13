import { Queue, QueueEvents } from "bullmq";
import IORedis from "ioredis";

// =========================
// ✅ Redis redis (singleton)
// =========================
export const redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  reconnectOnError: (err) => {
    console.error("[REDIS ERROR]", err.message);
    return true;
  },
});

// Logs
redis.on("connect", () => {
  console.log("Redis connected ✅");
});

redis.on("error", (err) => {
  console.error("Redis error ❌", err);
});

// =========================
// ✅ Queue
// =========================
export const ctraderQueue = new Queue("ctrader-trades", {
  redis,
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
// ✅ Queue Events
// =========================
export const ctraderQueueEvents = new QueueEvents("ctrader-trades", {
  redis,
});

ctraderQueueEvents.on("completed", ({ jobId }) => {
  console.log(`[QUEUE COMPLETED] jobId=${jobId}`);
});

ctraderQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`[QUEUE FAILED] jobId=${jobId} reason=${failedReason}`);
});

ctraderQueueEvents.on("stalled", ({ jobId }) => {
  console.warn(`[QUEUE STALLED] jobId=${jobId}`);
});
