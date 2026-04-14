import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const isProd = process.env.NODE_ENV === "production";

const transporter = nodemailer.createTransport({
  host: "smtppro.zoho.com",
  port: isProd ? 587 : 465,
  secure: isProd ? false : true,
  auth: {
    user: process.env.NO_REPLY_EMAIL_USER,
    pass: process.env.NO_REPLY_EMAIL_PASSWD,
  },
  tls: {
    rejectUnauthorized: false 
  },
  connectionTimeout: 10000, 
  greetingTimeout: 10000,
});

export default transporter;
