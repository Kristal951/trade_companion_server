import express from "express";
import { authenticateUser } from "../middlewares/authenticateUser.js";
import {
  createTelegramLinkCode,
  disconnectTelegram,
  getTelegramStatus,
  sendTestTelegramNotification,
  toggleTelegramNotification,
} from "../controllers/Telegram.js";

const router = express.Router();

router.post("/create-link-code", authenticateUser, createTelegramLinkCode);
router.post("/test", sendTestTelegramNotification);
router.post("/toggle-notification", authenticateUser, toggleTelegramNotification);
router.get("/status", authenticateUser, getTelegramStatus);
router.delete("/disconnect", authenticateUser, disconnectTelegram);

export default router;
