import mongoose from "mongoose";

const PlanName = {
  FREE: "Free",
  BASIC: "Basic",
  PRO: "Pro",
  PREMIUM: "Premium",
};

const EncryptedBlobSchema = new mongoose.Schema(
  {
    iv: { type: String, default: null },
    tag: { type: String, default: null },
    data: { type: String, default: null },
  },
  { _id: false },
);

export const CTraderSchema = new mongoose.Schema(
  {
    accountId: { type: String, default: null },

    accessTokenEnc: { type: EncryptedBlobSchema, select: false, default: null },
    refreshTokenEnc: {
      type: EncryptedBlobSchema,
      select: false,
      default: null,
    },
    allowedPairs: {
      type: [String],
      default: [],
    },
    cachedBalance: { type: Number, default: 0 },
    cachedEquity: { type: Number, default: 0 },
    cachedMargin: { type: Number, default: 0 },
    lastSyncedAt: { type: Date, default: null },
    autoSyncBalance: { type: Boolean, default: true },

    acquiredAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    scope: { type: String, default: null },
    tokenType: { type: String, default: "bearer" },

    isConnected: { type: Boolean, default: false },
    autoTradeEnabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const TradeSettingsSchema = new mongoose.Schema(
  {
    balance: { type: Number, default: 0 },
    risk: { type: Number, default: 1 },
    currency: { type: String, default: "USD" },
  },
  { _id: false },
);

export const NotificationSettingsSchema = new mongoose.Schema({
  email: { type: Boolean, default: false },
  push: { type: Boolean, default: true },
  telegram: { type: Boolean, default: false },
});

export const tradeHistorySchema = new mongoose.Schema({
  // id: string; // Unique ID for the trade
  status: { type: String, enum: ["active", "win", "loss"] },
  pnl: { type: Number },
  currentPrice: { type: Number },
  dateTaken: { type: Date },
  dateClosed: { type: Date },
  initialEquity: { type: Number },
  finalEquity: { type: Number },
  takeProfit: [{ type: Number }],
});

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    email: { type: String, required: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    verificationCode: { type: String },
    verificationCodeSentAt: { type: Date },

    password: { type: String, select: false },
    isGoogle: { type: Boolean, default: false },

    avatar: { type: String, default: null },
    age: { type: Number, default: null },
    telegram: {
      chatId: { type: String, default: null },
      username: { type: String, default: null },
      linkedAt: { type: Date, default: null },
    },
    telegramLinkCode: { type: String, default: null },
    telegramLinkCodeExpiresAt: { type: Date, default: null },

    subscribedPlan: {
      type: String,
      enum: Object.values(PlanName),
      default: PlanName.FREE,
    },

    isSubscribed: { type: Boolean, default: false },
    subscriptionStatus: { type: String, default: null },
    subscriptionMethod: {
      type: String,
      enum: ["stripe", "manual", "promo", "apple", "google_play"],
      default: null,
    },
    subscriptionPriceKey: { type: String, default: null },
    subscriptionInterval: { type: String, default: null },
    subscriptionCurrentPeriodEnd: { type: Date, default: null },
    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },
    stripeCheckoutSessionId: { type: String, default: null },

    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    lastLoginLocation: {
      country: { type: String, default: null },
      city: { type: String, default: null },
      region: { type: String, default: null },
    },

    tradeSettings: {
      type: TradeSettingsSchema,
      default: () => ({}),
    },

    isMentor: { type: Boolean, default: false },
    mentorID: { type: String, default: null },
    notificationSettings: {
      type: NotificationSettingsSchema,
      default: () => ({}),
    },

    cTraderConfig: { type: CTraderSchema, default: () => ({}) },
  },
  { timestamps: true },
);

UserSchema.index({ lastLoginAt: -1 });
UserSchema.index({ "cTraderConfig.accountId": 1 });
UserSchema.index({ stripeCustomerId: 1 });
UserSchema.index({ stripeSubscriptionId: 1 });
UserSchema.index({ stripeCheckoutSessionId: 1 });

UserSchema.statics.findWithCtraderTokens = function (query) {
  return this.findOne(query).select(
    "+cTraderConfig.accessTokenEnc +cTraderConfig.refreshTokenEnc",
  );
};

const UserModel = mongoose.model("User", UserSchema);
export default UserModel;
