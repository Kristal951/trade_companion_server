import { emailVerificationtemplate } from "../templates/index.js";
import transporter from "../config/nodemailer.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

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

export const verifyGoogleToken = async (token) => {
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  const ticket = await client.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  return ticket.getPayload();
};
