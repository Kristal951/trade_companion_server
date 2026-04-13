import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from "http";

import userRoutes from "./routes/User.js";
import mentorRoutes from "./routes/Mentor.js";
import StripeRoutes from "./routes/Stripe.js";
import planRoutes from "./routes/Plans.js";
import signalRoutes from "./routes/Signals.js";
import ctraderRoutes from "./routes/Ctrader.js";
import notificationRoutes from "./routes/Notification.js";
import telegramRoutes from "./routes/Telegram.js";
import marketRoutes from "./routes/market.js";
import TradeRoutes from "./routes/trades.js";

import { registerNotificationSocket } from "./sockets/NotificationSocket.js";
import { startTelegramBot } from "./services/Telegram.js";

import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { ctraderQueue } from "./queues/ctrader.js";

import { initRedis } from "./utils/redis.js";
import { connectDB } from "./utils/connectDB.js";
import { startActiveTradeStream } from "./services/activeTradeStream.js";
import { initIO, getIO } from "./sockets/io.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT_NUMBER || 5000;

/* =========================
   SOCKET.IO INIT
========================= */
initIO(server);

/* =========================
   CORS CONFIG
========================= */

const allowedOrigins = new Set(
  [
    process.env.FRONTEND_URI_1,
    process.env.FRONTEND_URI_2,
    process.env.FRONTEND_URI_3,
  ].filter(Boolean),
);

const corsOptions = {
  origin: (origin, callback) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("CORS origin:", origin);
    }

    if (!origin) return callback(null, true);

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
};

/* =========================
   BULL BOARD
========================= */

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(ctraderQueue)],
  serverAdapter,
});

/* =========================
   STRIPE WEBHOOK (MUST BE FIRST)
========================= */

app.use(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
);

/* =========================
   MIDDLEWARE
========================= */

app.set("trust proxy", true);
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.use(cookieParser());
app.use(express.json({ limit: "10mb" }));

/* =========================
   BASIC ROUTE
========================= */

app.get("/", (_req, res) => {
  res.send("🚀 Server is running...");
});

/* =========================
   ROUTES
========================= */

app.use("/api/user", userRoutes);
app.use("/api/mentor", mentorRoutes);
app.use("/api/stripe", StripeRoutes);
app.use("/api/signals", signalRoutes);
app.use("/api/ctrader", ctraderRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/telegram", telegramRoutes);
app.use("/api/market", marketRoutes);
app.use("/api/trades", TradeRoutes);

/* =========================
   BULL BOARD AUTH (FIXED ORDER)
========================= */

app.use("/admin/queues", (req, res, next) => {
  const auth = {
    login: process.env.ADMIN_USER || "admin",
    password: process.env.ADMIN_PASS || "kristal_951",
  };

  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = Buffer.from(b64auth, "base64")
    .toString()
    .split(":");

  if (login === auth.login && password === auth.password) {
    return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="401"');
  return res.status(401).send("Authentication required.");
});

app.use("/admin/queues", serverAdapter.getRouter());

/* =========================
   ERROR HANDLING
========================= */

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error("Error middleware:", err.message);

  if (err.message?.startsWith("Not allowed by CORS")) {
    return res.status(403).json({ message: err.message });
  }

  res.status(500).json({
    message: "Something went wrong",
    error: err.message,
  });
});

/* =========================
   START SERVER (SAFE ORDER)
========================= */

const startServer = async () => {
  try {
    console.log("🚀 Starting server...");

    await connectDB();
    console.log("✅ Database connected");

    await initRedis();
    console.log("✅ Redis initialized");

    initIO(server);

    const io = getIO();

    startActiveTradeStream();
    registerNotificationSocket(io);

    startTelegramBot();

    server.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err.message);
    process.exit(1);
  }
};

startServer();