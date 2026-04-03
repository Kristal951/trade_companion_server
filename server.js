import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import http from "http";
import { Server } from "socket.io";

import userRoutes from "./routes/User.js";
import mentorRoutes from "./routes/Mentor.js";
import StripeRoutes from "./routes/Stripe.js";
import planRoutes from "./routes/Plans.js";
import signalRoutes from "./routes/Signals.js";
import ctraderRoutes from "./routes/Ctrader.js";
import notificationRoutes from "./routes/Notification.js";
import telegramRoutes from "./routes/Telegram.js";
import { registerNotificationSocket } from "./sockets/NotificationSocket.js";
import { registerTelegramHandlers } from "./services/Telegram.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT_NUMBER || 5000;

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  process.env.FRONTEND_URI_1,
  process.env.FRONTEND_URI_2,
  process.env.FRONTEND_URI_3,
  process.env.FRONTEND_BASE_URL,
].filter(Boolean);

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ Database connected successfully");
  } catch (error) {
    console.error("❌ Error connecting to MongoDB:", error.message);
    process.exit(1);
  }
};

const corsOptions = {
  origin: (origin, callback) => {
    console.log("CORS origin:", origin);

    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
  allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
  optionsSuccessStatus: 204,
};

app.set("trust proxy", true);

app.use(cookieParser());
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

app.get("/", (_req, res) => {
  res.send("🚀 Server is running...");
});

app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));

app.use("/api/user", userRoutes);
app.use("/api/mentor", mentorRoutes);
app.use("/api/stripe", StripeRoutes);
app.use("/api/signals", signalRoutes);
app.use("/api/ctrader", ctraderRoutes);
app.use("/api/plans", planRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/telegram", telegramRoutes);

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

export const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});
app.set("io", io);

registerNotificationSocket(io);
registerTelegramHandlers();

const startServer = async () => {
  await connectDB();

  server.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
  });
};

startServer();
