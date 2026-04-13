import dotenv from "dotenv";
import { connectDB } from "../utils/connectDB.js";
import { initRedis } from "../utils/redis.js";
import { ctraderClient } from "../services/ctraderClient.js";
import { createCtraderWorker } from "./ctrader.js";

dotenv.config();

const startWorker = async () => {
  try {
    console.log("🚀 Starting worker...");

    await connectDB();
    console.log("✅ DB connected");

    await initRedis();
    console.log("✅ Redis connected");

    console.log("🔗 Connecting to cTrader...");
    await ctraderClient.connect(); 

    console.log("🚀 cTrader ready");

    createCtraderWorker();
    console.log("🔥 Worker processing jobs...");

  } catch (err) {
    console.error("❌ Worker failed:", err.message);
    process.exit(1);
  }
};

startWorker();