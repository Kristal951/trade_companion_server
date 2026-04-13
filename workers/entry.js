import dotenv from "dotenv";
import { connectDB } from "../utils/connectDB.js";
import { ctraderClient } from "../services/ctraderClient.js";
import { createCtraderWorker } from "./ctrader.js";

dotenv.config();

const startWorker = async () => {
  try {
    console.log("🚀 Starting worker...");

    // =========================
    // DB
    // =========================
    await connectDB();
    console.log("✅ DB connected");
    console.log("🔌 Redis assumed ready (singleton design)");

    // =========================
    // CTRADER
    // =========================
    console.log("🔗 Connecting to cTrader...");
    await ctraderClient.connect();
    console.log("🚀 cTrader ready");

    // =========================
    // WORKER
    // =========================
    const worker = createCtraderWorker();
    console.log("🔥 Worker processing jobs...");

    // =========================
    // SAFE SHUTDOWN (IMPORTANT)
    // =========================
    process.on("SIGINT", async () => {
      console.log("🛑 Shutting down worker...");

      await worker.close();
      await ctraderClient.disconnect?.();

      process.exit(0);
    });

    process.on("SIGTERM", async () => {
      console.log("🛑 SIGTERM received");

      await worker.close();
      await ctraderClient.disconnect?.();

      process.exit(0);
    });
  } catch (err) {
    console.error("❌ Worker failed:", err.message);
    process.exit(1);
  }
};

startWorker();
