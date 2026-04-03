import axios from "axios";
import UserModel from "../models/User.js";
import TelegramBot from "node-telegram-bot-api";
import crypto from "crypto";
import Notification from "../models/Notification.js";

const APP_URL = process.env.NGROK_URL || process.env.CLIENT_URL;
const token = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const TELEGRAM_CAPTION_LIMIT = 1024;
const TELEGRAM_MESSAGE_LIMIT = 4096;

const trimText = (text = "", limit = TELEGRAM_MESSAGE_LIMIT) => {
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 3)}...`;
};

export const findNotificationByDedupeKey = async (dedupeKey) => {
  if (!dedupeKey) return null;
  return Notification.findOne({ dedupeKey });
};

export const generateTelegramLinkCode = () => {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
};

const stripHtml = (text = "") => {
  return String(text)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .trim();
};

const formatValue = (value, fallback = "N/A") => {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
};

const escapeHtml = (unsafe = "") => {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
};

const buildTelegramLink = (linkTo = "") => {
  const baseUrl =
    process.env.NGROK_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.CLIENT_URL;

  if (!baseUrl || !linkTo) return null;

  const cleanBase = String(baseUrl).replace(/\/+$/, "");
  const cleanPath = String(linkTo).startsWith("/") ? linkTo : `/${linkTo}`;

  const fullUrl = `${cleanBase}${cleanPath}`;

  if (!/^https:\/\//i.test(fullUrl)) {
    return null;
  }

  return fullUrl;
};

const buildTelegramNotificationMessage = ({
  title,
  message,
  priority = "normal",
}) => {
  const priorityEmoji =
    priority === "high" ? "🚨" : priority === "low" ? "🔕" : "📩";

  return trimText(
    `
${priorityEmoji} <b>${escapeHtml(title || "Notification")}</b>

${escapeHtml(message || "You have a new notification.")}
    `.trim(),
  );
};

export const telegramBot = token
  ? new TelegramBot(token, { polling: process.env.NODE_ENV !== "production" })
  : null;

export const registerTelegramHandlers = () => {
  if (!telegramBot) return;
  telegramBot.onText(/^\/start$/, async (msg) => {
    await telegramBot.sendMessage(
      msg.chat.id,
      "Welcome to Trade Companion.\nSend /link YOURCODE to connect your account.",
    );
  });
  telegramBot.onText(/^\/info$/, async (msg) => {
    await telegramBot.sendMessage(
      msg.chat.id,
      "Welcome to Trade Companion.\nmore info from www.tradescomapanion.com",
    );
  });
  telegramBot.onText(/^\/link\s+([A-Z0-9]+)$/i, async (msg, match) => {
    try {
      const code = match?.[1]?.toUpperCase()?.trim();
      if (!code) {
        return telegramBot.sendMessage(msg.chat.id, "Invalid link code.");
      }
      const user = await UserModel.findOne({ telegramLinkCode: code });
      if (!user) {
        return telegramBot.sendMessage(
          msg.chat.id,
          "This link code is invalid. Generate a new one in Trade Companion and try again.",
        );
      }
      if (
        !user.telegramLinkCodeExpiresAt ||
        user.telegramLinkCodeExpiresAt.getTime() <= Date.now()
      ) {
        user.telegramLinkCode = null;
        user.telegramLinkCodeExpiresAt = null;
        await user.save();
        return telegramBot.sendMessage(
          msg.chat.id,
          "This link code has expired. Please generate a new code in Trade Companion and try again.",
        );
      }
      user.telegram = {
        chatId: String(msg.chat.id),
        username: msg.from?.username || null,
        linkedAt: new Date(),
      };
      user.notificationSettings = {
        ...user.notificationSettings,
        telegram: true,
      };
      user.telegramLinkCode = null;
      user.telegramLinkCodeExpiresAt = null;
      await user.save();
      await telegramBot.sendMessage(
        msg.chat.id,
        "✅ Your Telegram account has been linked successfully.",
      );
    } catch (error) {
      console.error("Telegram link error:", error);
      await telegramBot.sendMessage(
        msg.chat.id,
        "Something went wrong while linking your account.",
      );
    }
  });
};

const getDirectionEmoji = (direction) => {
  const dir = String(direction || "").toUpperCase();
  if (dir === "BUY") return "🟢";
  if (dir === "SELL") return "🔴";
  return "📌";
};

const getDirectionLabel = (direction) => {
  const dir = String(direction || "").toUpperCase();
  if (dir === "BUY") return "BUY";
  if (dir === "SELL") return "SELL";
  return "SIGNAL";
};

const buildSignalMessage = ({ mentorName, title, signalDetails }) => {
  const direction = getDirectionLabel(signalDetails?.direction);
  const emoji = getDirectionEmoji(signalDetails?.direction);

  const instrument = formatValue(signalDetails?.instrument, "Market");
  const entry = formatValue(signalDetails?.entry);
  const stopLoss = formatValue(signalDetails?.stopLoss);
  const takeProfit = formatValue(signalDetails?.takeProfit);
  const timeframe = formatValue(signalDetails?.timeframe, "Not specified");
  const confidence = formatValue(signalDetails?.confidence, "Standard");
  const riskReward = formatValue(signalDetails?.riskReward, "Not specified");
  const note = signalDetails?.note ? stripHtml(signalDetails.note) : "";

  let message = `
🚨 <b>NEW TRADE ALERT</b> 🚨

${emoji} <b>${escapeHtml(direction)} ${escapeHtml(instrument)}</b>

👨‍🏫 <b>Mentor:</b> ${escapeHtml(mentorName)}
📝 <b>Title:</b> ${escapeHtml(title || "Trading Signal")}

📍 <b>Entry:</b> ${escapeHtml(entry)}
🛑 <b>Stop Loss:</b> ${escapeHtml(stopLoss)}
🎯 <b>Take Profit:</b> ${escapeHtml(takeProfit)}

⏱️ <b>Timeframe:</b> ${escapeHtml(timeframe)}
📊 <b>Confidence:</b> ${escapeHtml(confidence)}
⚖️ <b>Risk/Reward:</b> ${escapeHtml(riskReward)}
`.trim();

  if (note) {
    message += `\n\n🧠 <b>Note:</b>\n${escapeHtml(note)}`;
  }

  message += `\n\n🔥 <b>Stay disciplined. Manage your risk.</b>`;

  return trimText(message, TELEGRAM_MESSAGE_LIMIT);
};

const buildPostMessage = ({ mentorName, title, content }) => {
  const cleanContent = stripHtml(content || "");

  let message = `
📢 <b>NEW MENTOR POST</b>

👨‍🏫 <b>Mentor:</b> ${escapeHtml(mentorName)}
📝 <b>Title:</b> ${escapeHtml(title || "New Update")}

💬 <b>Message:</b>
${escapeHtml(cleanContent || "A new update has been shared.")}
`.trim();

  message += `\n\n👉 <b>Tap below to view full details.</b>`;

  return trimText(message, TELEGRAM_MESSAGE_LIMIT);
};

export const sendTelegramMessage = async (chatId, text, options = {}) => {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  const { data } = await axios.post(url, {
    chat_id: chatId,
    text: trimText(text, TELEGRAM_MESSAGE_LIMIT),
    ...options,
  });

  return data;
};

export const sendTelegramPhoto = async (
  chatId,
  photoUrl,
  caption,
  options = {},
) => {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN");
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

  const { data } = await axios.post(url, {
    chat_id: chatId,
    photo: photoUrl,
    caption: trimText(caption, TELEGRAM_CAPTION_LIMIT),
    ...options,
  });

  return data;
};

const getPostImageUrl = (post) => {
  if (!post) return null;

  if (Array.isArray(post.fileURLs) && post.fileURLs.length > 0) {
    const firstMedia = post.fileURLs[0];

    if (typeof firstMedia === "string") return firstMedia;
    if (firstMedia?.url) return firstMedia.url;
    if (firstMedia?.secure_url) return firstMedia.secure_url;
  }

  if (post.image) return post.image;
  if (post.imageUrl) return post.imageUrl;

  return null;
};

const buildInlineKeyboard = (mentorId) => ({
  inline_keyboard: [
    [
      {
        text: "📲 Open Trade Companion",
        url: `${APP_URL}/mentor/${mentorId}`,
      },
    ],
  ],
});

export const sendMentorPostTelegramAlerts = async ({
  subscriberIds,
  mentor,
  post,
  signalDetails,
}) => {
  try {
    if (!Array.isArray(subscriberIds) || subscriberIds.length === 0) {
      console.log("Telegram: no subscriberIds provided");
      return;
    }

    if (!mentor?._id || !mentor?.name || !post) {
      console.log("Telegram: missing mentor or post data");
      return;
    }

    const users = await UserModel.find({
      _id: { $in: subscriberIds },
      "telegram.chatId": { $exists: true, $ne: null },
      "notificationSettings.telegram": true,
    }).select("telegram notificationSettings name email");

    if (!users.length) {
      console.log("Telegram: no eligible users found");
      return;
    }

    const isSignal = post.type === "signal";
    const imageUrl = getPostImageUrl(post);

    const results = await Promise.allSettled(
      users.map(async (user) => {
        const chatId = user?.telegram?.chatId;

        if (!chatId) {
          throw new Error(`Missing telegram chatId for user ${user?._id}`);
        }

        const message = isSignal
          ? buildSignalMessage({
              mentorName: mentor.name,
              title: post.title,
              signalDetails,
            })
          : buildPostMessage({
              mentorName: mentor.name,
              title: post.title,
              content: post.content,
            });

        const replyMarkup = buildInlineKeyboard(String(mentor._id));

        if (imageUrl) {
          return await sendTelegramPhoto(chatId, imageUrl, message, {
            parse_mode: "HTML",
            reply_markup: replyMarkup,
          });
        }

        return await sendTelegramMessage(chatId, message, {
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: replyMarkup,
        });
      }),
    );

    const successCount = results.filter(
      (result) => result.status === "fulfilled",
    ).length;

    const failedResults = results.filter(
      (result) => result.status === "rejected",
    );

    failedResults.forEach((result) => {
      console.error(
        "Telegram send failed:",
        result.reason?.message || result.reason,
      );
    });

    console.log(
      `Telegram alerts completed: ${successCount} sent, ${failedResults.length} failed`,
    );

    return {
      success: true,
      total: users.length,
      sent: successCount,
      failed: failedResults.length,
    };
  } catch (error) {
    console.error("sendMentorPostTelegramAlerts error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};
export const createAndSendTelegramNotification = async ({
  recipient,
  title,
  message,
  linkTo = "",
  priority = "normal",
  meta = {},
  dedupeKey = null,
}) => {
  try {
    if (!recipient) {
      return {
        success: false,
        skipped: true,
        reason: "Missing recipient",
      };
    }

    const user = await UserModel.findById(recipient).select(
      "_id telegram notificationSettings telegramNotificationDedupes",
    );

    if (!user) {
      return {
        success: false,
        skipped: true,
        reason: "User not found",
      };
    }

    const chatId = user?.telegram?.chatId;
    const telegramEnabled = user?.notificationSettings?.telegram === true;

    if (!chatId || !telegramEnabled) {
      return {
        success: false,
        skipped: true,
        reason: "Telegram not connected or disabled",
      };
    }

    if (dedupeKey) {
      const existing = await findNotificationByDedupeKey(dedupeKey);

      if (existing) {
        return {
          success: true,
          duplicate: true,
          skipped: true,
          reason: "Duplicate telegram notification",
        };
      }
    }

    const text = buildTelegramNotificationMessage({
      title,
      message,
      priority,
    });

    const fullUrl = buildTelegramLink(linkTo);

    const options = {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    if (fullUrl) {
      options.reply_markup = {
        inline_keyboard: [
          [
            {
              text: "📲 Open Trade Companion",
              url: fullUrl,
            },
          ],
        ],
      };
    }

    const telegramRes = await sendTelegramMessage(chatId, text, options);

    if (dedupeKey) {
      await UserModel.updateOne(
        { _id: recipient },
        {
          $addToSet: { telegramNotificationDedupes: dedupeKey },
        },
      );
    }

    return {
      success: true,
      sent: true,
      channel: "telegram",
      recipient: String(recipient),
      chatId,
      telegramRes,
      meta,
    };
  } catch (error) {
    console.error(
      `Telegram notification failed for user ${recipient}:`,
      error?.response?.data || error.message || error,
    );

    return {
      success: false,
      sent: false,
      channel: "telegram",
      recipient: String(recipient),
      error: error?.response?.data || error.message || "Unknown telegram error",
    };
  }
};
