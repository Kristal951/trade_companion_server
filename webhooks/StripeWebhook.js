// src/webhooks/stripeWebhook.js
import express from "express";
import Stripe from "stripe";
import Mentor from "../models/Mentor.js";
import User from "../models/User.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const router = express.Router();

router.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
   
  }
);

export default router;
