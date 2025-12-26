import mongoose from "mongoose";

const planSchema = new mongoose.Schema({
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  features: {type: Array, required: true},
  currency: { type: String, default: "NGN" },
  interval: { type: String, enum: ["monthly", "yearly"], required: true },
  flutterwave_plan_id: { type: String, required: true },
});

export default mongoose.model("Plan", planSchema);
