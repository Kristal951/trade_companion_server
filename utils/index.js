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
  console.log("Sending email to:", to, name, code);

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

    console.log("Verification email sent successfully.");
  } catch (err) {
    console.error("Verification email failed:", err.message);
  }
};

export const sendVerificationEmailWithResend = async (email, name, code) => {
  console.log(email, name, code)
  const html = emailVerificationtemplate
      .replace(/{{NAME}}/g, name)
      .replace(/{{CODE}}/g, code)
      .replace(/{{YEAR}}/g, new Date().getFullYear())
      .replace(/{{APP_NAME}}/g, "Trade Companion");
  try {
    const data = await resend.emails.send({
      from: "onboarding@resend.dev", 
      to: 'tradescompanion@gmail.com',
      subject: "Verify your email",
      html: html
    });
    console.log("Verification email sent:", data);
    return data;
  } catch (error) {
    console.error("Resend error:", error);
    throw new Error("Email sending failed");
  }
};

export const sendForgotPasswordLinkWithResend = async ({to, subject, html}) => {
  console.log(to, subject)

  try {
    const data = await resend.emails.send({
      from: "onboarding@resend.dev", 
      to: to,
      subject: subject,
      html: html
    });
    console.log("email sent:", data);
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