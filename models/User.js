import mongoose from "mongoose";

const PlanName = {
  FREE: "FREE",
  BASIC: "BASIC",
  PREMIUM: "PREMIUM",
};

const CTraderSchema = new mongoose.Schema(
  {
    accountId: { type: String },
    accessToken: { type: String },
    isConnected: { type: Boolean, default: false },
    autoTradeEnabled: { type: Boolean, default: false },
  },
  { _id: false } 
);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    avatar: { type: String },
    telegramNumber: { type: String },
    subscribedPlan: {
      type: String,
      enum: Object.values(PlanName),
      default: PlanName.FREE,
    },
    isMentor: { type: Boolean, required: true },
    cTraderConfig: { type: CTraderSchema },
  },
  { timestamps: true }
);

const UserModel = mongoose.model("User", UserSchema);

export default UserModel
