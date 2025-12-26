import mongoose from "mongoose";
import dotenv from "dotenv";
import Plans from "./models/Plans.js";

dotenv.config();
try {
  mongoose.connect(process.env.MONGO_URI);
} catch (error) {
  console.log(error);
}

const seedPlans = async () => {
  const plans = [
    {
      name: "Basic Monthly",
      amount: 29,
      interval: "monthly",
      features: [
        "2 AI Signals / day (FX Majors & Minors)",
        "3 Entry analyses per day",
        "2 AI chart analyses per day",
        "1 In-depth AI analysis per day",
        "Community Access",
      ],
      currency: "USD",
      flutterwave_plan_id: "228368",
    },
    {
      name: "Basic Yearly",
      amount: 290,
      interval: "yearly",
      features: [
        "2 AI Signals / day (FX Majors & Minors)",
        "3 Entry analyses per day",
        "2 AI chart analyses per day",
        "1 In-depth AI analysis per day",
        "Community Access",
      ],
      currency: "USD",
      flutterwave_plan_id: "228369",
    },
    {
      name: "Pro Monthly",
      amount: 59,
      interval: "monthly",
      features: [
        "5 AI Signals / day (All Pairs, XAU Priority)",
        "10 Entry analyses per day",
        "7 AI chart analyses per day",
        "5 In-depth AI analyses per day",
        "Telegram Notifications",
        "cTrader Automated Trading",
        "Advanced Analytics",
      ],
      currency: "USD",
      flutterwave_plan_id: "228370",
    },
    {
      name: "Pro Yearly",
      amount: 590,
      interval: "yearly",
      features: [
        "5 AI Signals / day (All Pairs, XAU Priority)",
        "10 Entry analyses per day",
        "7 AI chart analyses per day",
        "5 In-depth AI analyses per day",
        "Telegram Notifications",
        "cTrader Automated Trading",
        "Advanced Analytics",
      ],
      currency: "USD",
      flutterwave_plan_id: "228371",
    },
    {
      name: "Premium Monthly",
      amount: 99,
      interval: "monthly",
      features: [
        "10 AI Signals / day (All Pairs, XAU Priority)",
        "Unlimited entry analyses",
        "Unlimited AI chart analyses",
        "Unlimited in-depth AI analyses",
        "Telegram Notifications",
        "cTrader Automated Trading",
        "1 Free Mentor for a month",
      ],
      currency: "USD",
      flutterwave_plan_id: "228373",
    },
    {
      name: "Premium Yearly",
      amount: 990,
      currency: "USD",
      features: [
        "10 AI Signals / day (All Pairs, XAU Priority)",
        "Unlimited entry analyses",
        "Unlimited AI chart analyses",
        "Unlimited in-depth AI analyses",
        "Telegram Notifications",
        "cTrader Automated Trading",
        "1 Free Mentor for a month",
      ],
      interval: "yearly",
      flutterwave_plan_id: "228374",
    },
  ];

  try {
    const initial = await Plans.deleteMany();
    const followUp = await Plans.insertMany(plans);

    console.log("first", initial);
    console.log("second", followUp);
  } catch (error) {
    console.log(error, "error2");
  }

  console.log("Plans seeded to MongoDB");
  mongoose.disconnect();
};

console.log("done");

seedPlans();
