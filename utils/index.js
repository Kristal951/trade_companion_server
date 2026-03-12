import { emailVerificationtemplate } from "../templates/index.js";
import transporter from "../config/nodemailer.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import fs from "fs";
import multer from "multer";
import { Resend } from "resend";

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