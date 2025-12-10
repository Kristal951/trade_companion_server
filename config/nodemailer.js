import nodemailer from "nodemailer";
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
   host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.NODEMAILER_EMAIL_NAME,
    pass: process.env.NODEMAILER_EMAIL_PASSWD,
  },
});

export default transporter;
