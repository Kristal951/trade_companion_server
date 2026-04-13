import { ctraderQueue } from "../queues/ctrader.js";

export async function dispatchSignalToUser(userId, signal) {
  console.log("QUEUEING SIGNAL:", userId, signal._id);

  const jobId = `trade:${userId}:${signal._id}`;

  await ctraderQueue.add(
    "execute-trade",
    {
      userId,
      signal,
    },
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    }
  );

  console.log("[DISPATCHED]", jobId);

  return { success: true, jobId };
}