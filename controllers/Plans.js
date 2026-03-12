import Plans from "../models/Plans.js";
import dotenv from "dotenv";
dotenv.config();
import axios from "axios";
import { flw } from "../utils/flutterWave.js";

export const getPlans = async (req, res) => {
  try {
    const plans = await Plans.find({});
    return res.status(200).json(plans);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: "Could not get all plans" });
  }
};

export const getPlanByID = async (req, res) => {
  const { planId } = req.params;
  try {
    const plan = await Plans.findById(planId);
    if (!plan) {
      return res.status(404).json({ message: "Plan not found" });
    }
    return res.status(200).json(plan);
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Could not find plan" });
  }
};

export const startSubscriptionPayment = async (req, res) => {
  const { name, email, planKey, planID } = req.body;

  if (!name || !email || !planKey || !planID) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  if (planKey === "Free") {
    return res.status(200).json({
      success: true,
      message: "Free plan activated",
    });
  }

  const planIdMap = {
    basic_monthly: process.env.FLW_BASIC_MONTHLY_ID,
    pro_monthly: process.env.FLW_PRO_MONTHLY_ID,
    premium_monthly: process.env.FLW_PREMIUM_MONTHLY_ID,
    basic_yearly: process.env.FLW_BASIC_YEARLY_ID,
    pro_yearly: process.env.FLW_PRO_YEARLY_ID,
    premium_yearly: process.env.FLW_PREMIUM_YEARLY_ID,
  };

  const paymentPlanId = planIdMap[planKey];

  if (!paymentPlanId) {
    return res.status(400).json({ message: "Invalid plan selected" });
  }

  const getPlan = await axios.get(
    `http://localhost:5000/api/plans/getPlan/${planID}`
  );
  const amount = getPlan.data.amount;

  const payload = {
    tx_ref: `sub_${planKey}_${Date.now()}`,
    currency: "USD",
    amount: amount,
    redirect_url: "http://localhost:3000/payment/flutterwave/callback",
    customer: {
      email: email,
      name: name
    },
    payment_plan: paymentPlanId,
  };

  try {
    const response = await axios.post(
      "https://api.flutterwave.com/v3/payments",
      payload,
      {
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(200).json({
      success: true,
      payment_link: response.data.data.link,
    });
  } catch (error) {
    console.error(
      "Subscription start error:",
      error.response?.data || error.message
    );

    return res.status(500).json({
      message: "Failed to start subscription",
      error: error.response?.data,
    });
  }
};
