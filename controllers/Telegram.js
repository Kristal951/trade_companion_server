import UserModel from "../models/User.js";
import {
  generateTelegramLinkCode,
  sendTelegramMessage,
} from "../services/Telegram.js";

export const createTelegramLinkCode = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await UserModel.findById(userId).select("_id");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const code = generateTelegramLinkCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await UserModel.findByIdAndUpdate(userId, {
      telegramLinkCode: code,
      telegramLinkCodeExpiresAt: expiresAt,
    });

    return res.status(200).json({
      code,
      botUsername: process.env.TELEGRAM_BOT_USERNAME || "TradeCompanionBot",
      expiresAt,
      message: "Telegram link code created successfully",
    });
  } catch (error) {
    console.error("createTelegramLinkCode error:", error);
    return res.status(500).json({
      message: "Failed to create Telegram link code",
    });
  }
};

export const sendTestTelegramNotification = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await UserModel.findById(userId).select("telegram");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user?.telegram?.chatId) {
      return res.status(400).json({ message: "Telegram not linked" });
    }

    await sendTelegramMessage(
      user.telegram.chatId,
      "✅ Telegram notification test successful from Trade Companion.",
    );

    return res.status(200).json({
      message: "Test message sent successfully",
    });
  } catch (error) {
    console.error("sendTestTelegramNotification error:", error);
    return res.status(500).json({
      message: "Failed to send test notification",
    });
  }
};

export const disconnectTelegram = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await UserModel.findByIdAndUpdate(
      userId,
      {
        telegram: {
          chatId: null,
          username: null,
          linkedAt: null,
        },
        telegramLinkCode: null,
        telegramLinkCodeExpiresAt: null,
        "notificationSettings.telegram": false,
      },
      { new: true },
    ).select("telegram notificationSettings");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      message: "Telegram disconnected successfully",
      telegram: user.telegram,
      notificationSettings: user.notificationSettings,
    });
  } catch (error) {
    console.error("disconnectTelegram error:", error);
    return res.status(500).json({
      message: "Failed to disconnect Telegram",
    });
  }
};

export const getTelegramStatus = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await UserModel.findById(userId).select(
      "telegram notificationSettings",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isConnected = Boolean(user?.telegram?.chatId);

    return res.status(200).json({
      connected: isConnected,
      telegram: isConnected
        ? {
            chatId: user.telegram?.chatId ?? null,
            username: user.telegram?.username ?? null,
            linkedAt: user.telegram?.linkedAt ?? null,
          }
        : null,
      notificationSettings: user.notificationSettings || {
        email: false,
        push: false,
        telegram: false,
      },
    });
  } catch (error) {
    console.error("getTelegramStatus error:", error);
    return res.status(500).json({
      message: "Failed to fetch Telegram status",
    });
  }
};
export const toggleTelegramNotification = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { enabled } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ message: "enabled must be a boolean" });
    }

    const user = await UserModel.findById(userId).select(
      "telegram notificationSettings",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (enabled && !user?.telegram?.chatId) {
      return res.status(400).json({
        message: "Connect Telegram first before enabling notifications",
      });
    }

    user.notificationSettings = {
      ...user.notificationSettings,
      telegram: enabled,
    };

    await user.save();
    

    return res.status(200).json({
      message: enabled
        ? "Telegram notifications enabled"
        : "Telegram notifications disabled",
      notificationSettings: user.notificationSettings,
    });
  } catch (error) {
    console.error("toggleTelegramNotification error:", error);
    return res.status(500).json({
      message: "Failed to update Telegram notifications",
    });
  }
};
