import crypto from "crypto";
import UserModel from "../models/User.js";
import { TradeSignal } from "../models/TradeSignal.js";
import { scanForSignals } from "../services/scanForSignals.js";
import { getDailySignalLimit, isSignalEligiblePlan } from "../utils/signal.js";
import { normalizePlan } from "../utils/index.js";
import { createAndSendTelegramNotification } from "../services/Telegram.js";
import { createAndSendNotification } from "../services/Notification.js";
import { io } from "../server.js";

const DUPLICATE_WINDOW_MINUTES = 45;

function getStartOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function buildDedupeKey({
  userId,
  instrument,
  type,
  entryPrice,
  stopLoss,
  takeProfit1,
  dayKey,
}) {
  const raw = [
    userId,
    instrument,
    type,
    entryPrice,
    stopLoss,
    takeProfit1,
    dayKey,
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function runSignalScanJob() {
  console.log("=== SIGNAL SCAN JOB STARTED ===");
  console.log("Started at:", new Date().toISOString());

  const users = await UserModel.find({
    emailVerified: true,
    isSubscribed: true,
  }).lean();

  console.log("Users fetched:", users.length);

  const summary = {
    usersChecked: 0,
    ineligibleSkipped: 0,
    dailyLimitSkipped: 0,
    duplicatesSkipped: 0,
    signalsCreated: 0,
    failures: 0,
  };

  const startOfToday = getStartOfToday();
  const dayKey = startOfToday.toISOString().slice(0, 10);

  console.log("Start of today:", startOfToday.toISOString());
  console.log("Day key:", dayKey);

  for (const user of users) {
    summary.usersChecked += 1;

    console.log("--------------------------------------------------");
    console.log("Processing user:", {
      id: String(user._id),
      email: user.email,
      subscribedPlan: user.subscribedPlan,
      isSubscribed: user.isSubscribed,
      emailVerified: user.emailVerified,
      pushEnabled: !!user?.notificationSettings?.push,
      telegramEnabled: !!user?.notificationSettings?.telegram,
      telegramLinked: !!user?.telegram?.chatId,
    });

    try {
      const normalizedPlan = normalizePlan(user.subscribedPlan);
      console.log("Normalized plan:", normalizedPlan);

      if (!isSignalEligiblePlan(normalizedPlan)) {
        console.log("Skipped user: ineligible plan");
        summary.ineligibleSkipped += 1;
        continue;
      }

      const dailyLimit = getDailySignalLimit(normalizedPlan);
      console.log("Daily limit:", dailyLimit);

      if (dailyLimit <= 0) {
        console.log("Skipped user: daily limit is 0");
        summary.ineligibleSkipped += 1;
        continue;
      }

      console.log("Checking signals sent today...");
      const signalsSentToday = await TradeSignal.countDocuments({
        userId: String(user._id),
        createdAt: { $gte: startOfToday },
      });

      console.log("Signals sent today:", signalsSentToday);

      if (signalsSentToday >= dailyLimit) {
        console.log("Skipped user: daily limit reached");
        summary.dailyLimitSkipped += 1;
        continue;
      }

      const settings = {
        balance: String(user.tradeSettings?.balance || "10000"),
        risk: String(user.tradeSettings?.risk || "1"),
        currency: String(user.tradeSettings?.currency || "USD"),
      };

      console.log("User settings for scan:", settings);
      console.log("Calling scanForSignals...");

      const result = await scanForSignals({
        userPlan: normalizedPlan,
        userSettings: settings,
      });

      console.log("scanForSignals result:", result);

      if (!result.signalFound) {
        console.log("No signal found for user");
        continue;
      }

      const duplicateSince = new Date(
        Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000,
      );

      console.log(
        "Checking recent duplicate since:",
        duplicateSince.toISOString(),
      );

      const recentDuplicate = await TradeSignal.findOne({
        userId: String(user._id),
        instrument: result.instrument,
        type: result.type,
        status: { $in: ["NEW", "EXECUTED"] },
        createdAt: { $gte: duplicateSince },
      }).lean();

      console.log("Recent duplicate exists:", !!recentDuplicate);

      if (recentDuplicate) {
        console.log("Skipped user: recent duplicate signal found");
        summary.duplicatesSkipped += 1;
        continue;
      }

      console.log("Re-checking signals sent today before create...");
      const freshSignalsSentToday = await TradeSignal.countDocuments({
        userId: String(user._id),
        createdAt: { $gte: startOfToday },
      });

      console.log("Fresh signals sent today:", freshSignalsSentToday);

      if (freshSignalsSentToday >= dailyLimit) {
        console.log("Skipped user: daily limit reached on re-check");
        summary.dailyLimitSkipped += 1;
        continue;
      }

      const signalDedupeKey = buildDedupeKey({
        userId: String(user._id),
        instrument: result.instrument,
        type: result.type,
        entryPrice: result.entryPrice,
        stopLoss: result.stopLoss,
        takeProfit1: result.takeProfit1,
        dayKey,
      });

      console.log("Generated signal dedupeKey:", signalDedupeKey);

      let createdSignal;

      try {
        console.log("Creating TradeSignal...");

        createdSignal = await TradeSignal.create({
          userId: String(user._id),
          instrument: result.instrument,
          type: result.type,
          isAI: true,
          entryPrice: result.entryPrice,
          stopLoss: result.stopLoss,
          takeProfits: [result.takeProfit1],
          confidence: result.confidence,
          reasoning: result.reasoning,
          technicalReasoning: result.technicalReasoning,
          lotSize: result.lotSize,
          riskAmount: result.riskAmount,
          status: "NEW",
          dedupeKey: signalDedupeKey,
          meta: {
            plan: normalizedPlan,
            originalPlan: user.subscribedPlan,
            generatedAtUtc: new Date().toUTCString(),
            source: "hybrid-96-candle-scan",
          },
        });

        console.log("TradeSignal created:", {
          id: String(createdSignal._id),
          instrument: createdSignal.instrument,
          type: createdSignal.type,
          status: createdSignal.status,
        });
      } catch (error) {
        if (error?.code === 11000) {
          console.log("Duplicate key error on TradeSignal.create, skipping");
          summary.duplicatesSkipped += 1;
          continue;
        }

        console.error("TradeSignal.create failed:", error);
        throw error;
      }

      const title = `${createdSignal.type} ${createdSignal.instrument}`;

      const takeProfit = Array.isArray(createdSignal.takeProfits)
        ? createdSignal.takeProfits.join(", ")
        : "N/A";

      const message = `
${createdSignal.type} ${createdSignal.instrument}

Entry: ${createdSignal.entryPrice}
Stop Loss: ${createdSignal.stopLoss}
Take Profit: ${takeProfit}

Confidence: ${createdSignal.confidence}%
`.trim();

      const notificationDedupeKey = `signal:${user._id}:${createdSignal._id}`;

      if (user?.notificationSettings?.push) {
        console.log("Sending in-app/realtime notification...");

        await createAndSendNotification({
          io,
          recipient: user._id,
          type: "signal",
          title,
          message,
          linkTo: "/ai_signals",
          priority: "high",
          deliveryChannels: {
            inApp: true,
            email: false,
            push: true,
          },
          meta: {
            signalId: String(createdSignal._id),
            instrument: createdSignal.instrument,
            signalType: createdSignal.type,
          },
          dedupeKey: `${notificationDedupeKey}:inapp`,
        });

        console.log("In-app/realtime notification sent");
      } else {
        console.log("Skipped in-app/realtime notification: push disabled");
      }

      if (user?.notificationSettings?.telegram && user?.telegram?.chatId) {
        console.log("Sending Telegram notification...");

        await createAndSendTelegramNotification({
          recipient: user._id,
          title,
          message,
          linkTo: "/ai_signals",
          priority: "high",
          meta: {
            signalId: String(createdSignal._id),
            instrument: createdSignal.instrument,
            signalType: createdSignal.type,
          },
          dedupeKey: `${notificationDedupeKey}:telegram`,
        });

        console.log("Telegram notification sent");
      } else {
        console.log("Skipped Telegram notification:", {
          telegramEnabled: !!user?.notificationSettings?.telegram,
          telegramLinked: !!user?.telegram?.chatId,
        });
      }

      summary.signalsCreated += 1;
      console.log("Signal created successfully for user");
    } catch (error) {
      summary.failures += 1;
      console.error(`Signal scan failed for user ${user._id}:`, error);
    }
  }

  console.log("=== SIGNAL SCAN JOB FINISHED ===");
  console.log("Final summary:", summary);

  return summary;
}