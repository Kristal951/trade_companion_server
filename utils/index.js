import { emailVerificationtemplate } from "../templates/index.js";
import transporter from "../config/nodemailer.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import multer from "multer";
import { Resend } from "resend";
import UserModel from "../models/User.js";
import { sendTelegramMessage } from "../services/Telegram.js";

export function generateVerificationToken({ email, code, userID }) {
  const payload = {
    email,
    code,
    userID,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
  };

  return jwt.sign(payload, process.env.JWT_SECRET);
}

export const sendVerificationEmail = async ({ to, name, code }) => {
  try {
    const html = emailVerificationtemplate
      .replace(/{{NAME}}/g, name)
      .replace(/{{CODE}}/g, code)
      .replace(/{{YEAR}}/g, new Date().getFullYear())
      .replace(/{{APP_NAME}}/g, "Trade Companion");

    try {
      await transporter.sendMail({
        from: `"Trade Companion" <tradecompanion001@gmail.com>`,
        to,
        subject: "Your Trade Companion Verification Code",
        html,
      });
    } catch (error) {
      console.log("email error", error);
    }
  } catch (err) {
    console.error("Verification email failed:", err.message);
  }
};

export const sendVerificationEmailWithResend = async (email, name, code) => {
  const html = emailVerificationtemplate
    .replace(/{{NAME}}/g, name)
    .replace(/{{CODE}}/g, code)
    .replace(/{{YEAR}}/g, new Date().getFullYear())
    .replace(/{{APP_NAME}}/g, "Trade Companion");
  try {
    const data = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "tradescompanion@gmail.com",
      subject: "Verify your email",
      html: html,
    });
    return data;
  } catch (error) {
    console.error("Resend error:", error);
    throw new Error("Email sending failed");
  }
};

export const sendForgotPasswordLinkWithResend = async ({
  to,
  subject,
  html,
}) => {
  try {
    const data = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: to,
      subject: subject,
      html: html,
    });
    return data;
  } catch (error) {
    console.error("Resend error:", error);
    throw new Error("Email sending failed");
  }
};

export const verifyGoogleToken = async (token) => {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
};

const tempDir = "temp_uploads";
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

export const upload = multer({ storage });

export const resend = new Resend(process.env.RESEND_API_KEY);

export const isActiveSubscriptionStatus = (status) => {
  return status === "active" || status === "trialing";
};

export const extractIntervalFromPlanKey = (planKey) => {
  const value = String(planKey || "")
    .toLowerCase()
    .trim();

  if (value.endsWith("-monthly")) return "month";
  if (value.endsWith("-yearly")) return "year";

  return null;
};

export const PLAN_NAME = {
  FREE: "Free",
  BASIC: "Basic",
  PRO: "Pro",
  PREMIUM: "Premium",
};

export const normalizePlan = (planKey) => {
  const value = String(planKey || "")
    .toLowerCase()
    .trim();

  const planMap = {
    free: PLAN_NAME.FREE,

    "basic-monthly": PLAN_NAME.BASIC,
    "basic-yearly": PLAN_NAME.BASIC,
    basic: PLAN_NAME.BASIC,

    "pro-monthly": PLAN_NAME.PRO,
    "pro-yearly": PLAN_NAME.PRO,
    pro: PLAN_NAME.PRO,

    "premium-monthly": PLAN_NAME.PREMIUM,
    "premium-yearly": PLAN_NAME.PREMIUM,
    premium: PLAN_NAME.PREMIUM,
  };

  return planMap[value] || PLAN_NAME.FREE;
};

export const sendTelegramNotificationToUser = async ({
  userId,
  title,
  message,
}) => {
  try {
    const user = await UserModel.findById(userId);

    if (!user?.telegram?.chatId) return;
    if (!user?.telegram?.notificationsEnabled) return;

    const text = `<b>${title}</b>\n\n${message}`;

    await sendTelegramMessage(user.telegram.chatId, text);
  } catch (error) {
    console.error("sendTelegramNotificationToUser error:", error.message);
  }
};

export const instrumentDefinitions = {
  // --- MAJORS ---
  "EUR/USD": {
    pipStep: 0.0001,
    quoteCurrency: "USD",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/USD",
    mockPrice: 1.085,
  },
  "GBP/USD": {
    pipStep: 0.0001,
    quoteCurrency: "USD",
    isForex: true,
    contractSize: 100000,
    symbol: "GBP/USD",
    mockPrice: 1.25,
  },
  "USD/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "USD/JPY",
    mockPrice: 155.0,
  },
  "USD/CHF": {
    pipStep: 0.0001,
    quoteCurrency: "CHF",
    isForex: true,
    contractSize: 100000,
    symbol: "USD/CHF",
    mockPrice: 0.915,
  },
  "USD/CAD": {
    pipStep: 0.0001,
    quoteCurrency: "CAD",
    isForex: true,
    contractSize: 100000,
    symbol: "USD/CAD",
    mockPrice: 1.365,
  },
  "AUD/USD": {
    pipStep: 0.0001,
    quoteCurrency: "USD",
    isForex: true,
    contractSize: 100000,
    symbol: "AUD/USD",
    mockPrice: 0.655,
  },
  "NZD/USD": {
    pipStep: 0.0001,
    quoteCurrency: "USD",
    isForex: true,
    contractSize: 100000,
    symbol: "NZD/USD",
    mockPrice: 0.605,
  },

  // --- MINORS (CROSSES) ---
  // EUR Crosses
  "EUR/GBP": {
    pipStep: 0.0001,
    quoteCurrency: "GBP",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/GBP",
    mockPrice: 0.855,
  },
  "EUR/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/JPY",
    mockPrice: 167.0,
  },
  "EUR/AUD": {
    pipStep: 0.0001,
    quoteCurrency: "AUD",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/AUD",
    mockPrice: 1.65,
  },
  "EUR/CAD": {
    pipStep: 0.0001,
    quoteCurrency: "CAD",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/CAD",
    mockPrice: 1.47,
  },
  "EUR/CHF": {
    pipStep: 0.0001,
    quoteCurrency: "CHF",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/CHF",
    mockPrice: 0.96,
  },
  "EUR/NZD": {
    pipStep: 0.0001,
    quoteCurrency: "NZD",
    isForex: true,
    contractSize: 100000,
    symbol: "EUR/NZD",
    mockPrice: 1.78,
  },

  // GBP Crosses
  "GBP/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "GBP/JPY",
    mockPrice: 185.0,
  },
  "GBP/AUD": {
    pipStep: 0.0001,
    quoteCurrency: "AUD",
    isForex: true,
    contractSize: 100000,
    symbol: "GBP/AUD",
    mockPrice: 1.92,
  },
  "GBP/CAD": {
    pipStep: 0.0001,
    quoteCurrency: "CAD",
    isForex: true,
    contractSize: 100000,
    symbol: "GBP/CAD",
    mockPrice: 1.71,
  },
  "GBP/CHF": {
    pipStep: 0.0001,
    quoteCurrency: "CHF",
    isForex: true,
    contractSize: 100000,
    symbol: "GBP/CHF",
    mockPrice: 1.12,
  },
  "GBP/NZD": {
    pipStep: 0.0001,
    quoteCurrency: "NZD",
    isForex: true,
    contractSize: 100000,
    symbol: "GBP/NZD",
    mockPrice: 2.08,
  },

  // AUD Crosses
  "AUD/CAD": {
    pipStep: 0.0001,
    quoteCurrency: "CAD",
    isForex: true,
    contractSize: 100000,
    symbol: "AUD/CAD",
    mockPrice: 0.9,
  },
  "AUD/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "AUD/JPY",
    mockPrice: 97.5,
  },
  "AUD/CHF": {
    pipStep: 0.0001,
    quoteCurrency: "CHF",
    isForex: true,
    contractSize: 100000,
    symbol: "AUD/CHF",
    mockPrice: 0.59,
  },
  "AUD/NZD": {
    pipStep: 0.0001,
    quoteCurrency: "NZD",
    isForex: true,
    contractSize: 100000,
    symbol: "AUD/NZD",
    mockPrice: 1.08,
  },

  // NZD Crosses
  "NZD/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "NZD/JPY",
    mockPrice: 91.0,
  },
  "NZD/CAD": {
    pipStep: 0.0001,
    quoteCurrency: "CAD",
    isForex: true,
    contractSize: 100000,
    symbol: "NZD/CAD",
    mockPrice: 0.82,
  },
  "NZD/CHF": {
    pipStep: 0.0001,
    quoteCurrency: "CHF",
    isForex: true,
    contractSize: 100000,
    symbol: "NZD/CHF",
    mockPrice: 0.54,
  },

  // CAD/CHF Crosses
  "CAD/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "CAD/JPY",
    mockPrice: 110.0,
  },
  "CAD/CHF": {
    pipStep: 0.0001,
    quoteCurrency: "CHF",
    isForex: true,
    contractSize: 100000,
    symbol: "CAD/CHF",
    mockPrice: 0.66,
  },
  "CHF/JPY": {
    pipStep: 0.01,
    quoteCurrency: "JPY",
    isForex: true,
    contractSize: 100000,
    symbol: "CHF/JPY",
    mockPrice: 168.0,
  },

  // --- METALS ---
  "XAU/USD": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 100,
    symbol: "XAU/USD",
    mockPrice: 2300.0,
  },
  "XAG/USD": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 5000,
    symbol: "XAG/USD",
    mockPrice: 27.0,
  },

  // --- CRYPTO ---
  "BTC/USD": {
    pipStep: 1,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 1,
    symbol: "BTC/USD",
    mockPrice: 65000.0,
  },
  "ETH/USD": {
    pipStep: 0.1,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 1,
    symbol: "ETH/USD",
    mockPrice: 3500.0,
  },
  "SOL/USD": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 1,
    symbol: "SOL/USD",
    mockPrice: 145.0,
  },

  // --- INDICES ---
  US500: {
    pipStep: 0.1,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 1,
    symbol: "SPX",
    mockPrice: 5200.0,
  },
  US100: {
    pipStep: 0.1,
    quoteCurrency: "USD",
    isForex: false,
    contractSize: 1,
    symbol: "NDX",
    mockPrice: 18000.0,
  },

  // --- DERIV SYNTHETICS ---
  "Volatility 10 Index": {
    pipStep: 0.001,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "R_10",
    mockPrice: 6500.0,
  },
  "Volatility 25 Index": {
    pipStep: 0.001,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "R_25",
    mockPrice: 2000.0,
  },
  "Volatility 50 Index": {
    pipStep: 0.001,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "R_50",
    mockPrice: 300.0,
  },
  "Volatility 75 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "R_75",
    mockPrice: 450000.0,
  },
  "Volatility 100 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "R_100",
    mockPrice: 2000.0,
  },
  "Crash 500 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "CRASH500",
    mockPrice: 4500.0,
  },
  "Crash 1000 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "CRASH1000",
    mockPrice: 6000.0,
  },
  "Boom 500 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "BOOM500",
    mockPrice: 5500.0,
  },
  "Boom 1000 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "BOOM1000",
    mockPrice: 12000.0,
  },
  "Jump 25 Index": {
    pipStep: 0.01,
    quoteCurrency: "USD",
    isForex: false,
    isDeriv: true,
    contractSize: 1,
    symbol: "JD25",
    mockPrice: 1500.0,
  },
};
