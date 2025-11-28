import nodemailer from "nodemailer";
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.NODEMAILER_EMAIL_NAME,
    pass: process.env.NODEMAILER_EMAIL_PASSWD,
  },
});

export default transporter;
