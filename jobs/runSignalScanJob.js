import crypto from "crypto";
import UserModel from "../models/User.js";
import { TradeSignal } from "../models/TradeSignal.js";
import { scanForSignals } from "../services/scanForSignals.js";
import { getDailySignalLimit, isSignalEligiblePlan } from "../utils/signal.js";
import { normalizePlan } from "../utils/index.js";
import { createAndSendTelegramNotification } from "../services/Telegram.js";
import { createAndSendNotification } from "../services/Notification.js";
import { dispatchSignalToUser } from "../services/signalDispatcher.js";
import { getIO } from "../sockets/io.js";

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
    });

    try {
      const normalizedPlan = normalizePlan(user.subscribedPlan);

      if (!isSignalEligiblePlan(normalizedPlan)) {
        summary.ineligibleSkipped += 1;
        continue;
      }

      const dailyLimit = getDailySignalLimit(normalizedPlan);

      if (dailyLimit <= 0) {
        summary.ineligibleSkipped += 1;
        continue;
      }

      const signalsSentToday = await TradeSignal.countDocuments({
        userId: String(user._id),
        createdAt: { $gte: startOfToday },
      });

      if (signalsSentToday >= dailyLimit) {
        console.log("daily signal limit reached");
        summary.dailyLimitSkipped += 1;
        continue;
      }

      const settings = {
        balance: String(user.tradeSettings?.balance || "10000"),
        risk: String(user.tradeSettings?.risk || "1"),
        currency: String(user.tradeSettings?.currency || "USD"),
      };

      const result = await scanForSignals({
        userPlan: normalizedPlan,
        userSettings: settings,
      });

      if (!result.signalFound) continue;

      const duplicateSince = new Date(
        Date.now() - DUPLICATE_WINDOW_MINUTES * 60 * 1000,
      );

      const recentDuplicate = await TradeSignal.findOne({
        userId: String(user._id),
        instrument: result.instrument,
        type: result.type,
        status: { $in: ["NEW", "EXECUTED"] },
        createdAt: { $gte: duplicateSince },
      }).lean();

      if (recentDuplicate) {
        summary.duplicatesSkipped += 1;
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

      let createdSignal;

      try {
        createdSignal = await TradeSignal.create({
          userId: String(user._id),
          instrument: result.instrument,
          type: result.type,
          isAI: true,
          entryPrice: result.entryPrice,
          stopLoss: result.stopLoss,
          takeProfits: result.takeProfits,
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
          },
        });
      } catch (error) {
        if (error?.code === 11000) {
          summary.duplicatesSkipped += 1;
          continue;
        }
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

      // =========================
      // AUTO TRADING EXECUTION
      // =========================
      try {
        if (!user?.cTraderConfig?.autoTradeEnabled) {
          console.log("Auto trading disabled for user");
        } else {
          console.log("🚀 Executing trade...");

          await TradeSignal.findByIdAndUpdate(createdSignal._id, {
            status: "QUEUED",
          });

          const signalPayload = {
            _id: createdSignal._id,
            userId: String(user._id),
            instrument: createdSignal.instrument,
            type: createdSignal.type,
            entryPrice: createdSignal.entryPrice,
            stopLoss: createdSignal.stopLoss,
            takeProfits: createdSignal.takeProfits ?? null,
            volume: createdSignal.lotSize,
            riskAmount: createdSignal.riskAmount,
            lotSize: createdSignal.lotSize
          };

          const executionResult = await dispatchSignalToUser(
            String(user._id),
            signalPayload,
          );

          if (executionResult?.success) {
            console.log(
              `[QUEUED] user=${user._id} signal=${createdSignal._id}`,
            );
          } else {
            throw new Error(executionResult?.error || "Execution failed");
          }
        }
      } catch (err) {
        console.error(
          `[AUTO TRADE ERROR] user=${user._id} signal=${createdSignal._id}`,
          err,
        );

        await TradeSignal.findByIdAndUpdate(createdSignal._id, {
          status: "FAILED",
          executionDetails: {
            error: err.message,
          },
        });
      }

      // =========================
      // NOTIFICATIONS
      // =========================
      if (user?.notificationSettings?.push) {
        const io = getIO();
        
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
          },
          dedupeKey: `${notificationDedupeKey}:inapp`,
        });
      }

      if (user?.notificationSettings?.telegram && user?.telegram?.chatId) {
        await createAndSendTelegramNotification({
          recipient: user._id,
          title,
          message,
          linkTo: "/ai_signals",
          priority: "high",
          meta: {
            signalId: String(createdSignal._id),
          },
          dedupeKey: `${notificationDedupeKey}:telegram`,
        });
      }

      summary.signalsCreated += 1;
    } catch (error) {
      summary.failures += 1;
      console.error(`Signal scan failed for user ${user._id}:`, error);
    }
  }

  console.log("=== SIGNAL SCAN JOB FINISHED ===");
  console.log("Final summary:", summary);

  return summary;
}
