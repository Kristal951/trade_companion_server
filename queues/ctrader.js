import { Queue, QueueEvents } from "bullmq";

// =========================
// ✅ Redis connection (Railway-safe)
// =========================
const connection = {
  url: process.env.REDIS_URL,
  maxRetriesPerRequest: null,
};

// hard fail if missing (prevents silent localhost fallback)
if (!process.env.REDIS_URL) {
  throw new Error("❌ REDIS_URL is missing in environment variables");
}

// optional debug
console.log("🔥 BullMQ REDIS_URL =", process.env.REDIS_URL);

// =========================
// ✅ Queue
// =========================
export const ctraderQueue = new Queue("ctrader-trades", {
  connection,
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
  connection,
});

// =========================
// Logs
// =========================
ctraderQueueEvents.on("completed", ({ jobId }) => {
  console.log(`[QUEUE COMPLETED] jobId=${jobId}`);
});

ctraderQueueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`[QUEUE FAILED] jobId=${jobId} reason=${failedReason}`);
});

ctraderQueueEvents.on("stalled", ({ jobId }) => {
  console.warn(`[QUEUE STALLED] jobId=${jobId}`);
});