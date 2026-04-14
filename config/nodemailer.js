import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

const transporter = nodemailer.createTransport({
  host: "smtppro.zoho.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.NO_REPLY_EMAIL_USER,
    pass: process.env.NO_REPLY_EMAIL_PASSWD,
  },
});

export default transporter;
