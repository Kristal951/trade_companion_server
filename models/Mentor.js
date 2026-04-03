import mongoose from "mongoose";

const { Schema } = mongoose;

const CertificationSchema = new Schema(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
  },
  { _id: false },
);

const RecentSignalSchema = new Schema({
  instrument: { type: String, required: true },
  direction: { type: String, enum: ["Buy", "Sell"], required: true },
  entry: { type: Number, required: true },
  stopLoss: { type: String },
  takeProfit: { type: String },
  outcome: { type: String, enum: ["profit", "loss"] },
  pnl: { type: Number },
  date: { type: Date, default: Date.now },
});

const SubscriberGrowthSchema = new Schema(
  {
    month: { type: String, required: true },
    subscribers: { type: Number, required: true },
  },
  { _id: false },
);

const SubscriberSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, required: true },
    avatar: { type: String },

    stripeCustomerId: { type: String },
    stripeSubscriptionId: { type: String },

    subscribedDate: { type: Date, default: Date.now },
    currentPeriodEnd: { type: Date },
    lastPaidAt: { type: Date },
    endedAt: { type: Date },

    status: {
      type: String,
      enum: ["Active", "Past Due", "Unpaid", "Incomplete", "Cancelled"],
      default: "Active",
    },

    ratingGiven: { type: Number, min: 0, max: 5 },
  },
  { _id: false },
);

const EarningsSchema = new Schema(
  {
    currentBalance: { type: Number, default: 0 },
    lifetime: { type: Number, default: 0 },
  },
  { _id: false },
);

const PayoutSchema = new Schema(
  {
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["Pending", "Completed", "Failed"],
      default: "Pending",
    },
  },
  { _id: false },
);

const DocumentSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["Not Submitted", "Pending", "Verified", "Rejected"],
      default: "Not Submitted",
    },
    type: { type: String },
    fileName: { type: String },
  },
  { _id: false },
);

const IdentitySchema = new Schema(
  {
    idDocument: {
      status: {
        type: String,
        enum: ["Not Submitted", "Pending", "Verified", "Rejected"],
        default: "Not Submitted",
      },
      type: {
        type: String,
        enum: [
          "Driver's License",
          "International Passport",
          "National ID",
          "NIN Slip",
        ],
      },
      fileName: String,
    },
    addressDocument: {
      status: {
        type: String,
        enum: ["Not Submitted", "Pending", "Verified", "Rejected"],
        default: "Not Submitted",
      },
      type: {
        type: String,
        enum: ["Utility Bill", "Bank Statement"],
      },
      fileName: String,
    },
    livenessCheck: {
      status: {
        type: String,
        enum: ["Not Submitted", "Pending", "Verified", "Rejected"],
        default: "Not Submitted",
      },
    },
    overallStatus: {
      type: String,
      enum: ["Not Submitted", "Pending", "Verified", "Rejected"],
      default: "Not Submitted",
    },
    rejectionReason: String,
  },
  { _id: false },
);

const AnalyticsSchema = new Schema(
  {
    earningsData: [
      {
        month: String,
        earnings: Number,
      },
    ],
    subscriberData: [
      {
        month: String,
        new: Number,
        churned: Number,
      },
    ],
    ratingDistribution: [
      {
        rating: Number,
        count: Number,
      },
    ],
    topSignals: [RecentSignalSchema],
  },
  { _id: false },
);

const ReviewSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    review: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const MentorSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    name: { type: String, required: true },
    avatar: { type: String },
    email: String,
    experience: { type: Number, required: true },
    profitRatio: { type: Number, required: true },
    instruments: [{ type: String }],
    price: { type: Number, required: true },
    stripeProductId: { type: String },
    stripePriceId: { type: String },
    roi: { type: Number, required: true },
    strategy: { type: String },

    rating: { type: Number, min: 0, max: 5 },
    reviewsCount: { type: Number, default: 0 },
    reviews: [ReviewSchema],

    posts: [{ type: Schema.Types.ObjectId, ref: "MentorPost" }],

    certifications: [CertificationSchema],
    recentSignals: [RecentSignalSchema],
    subscriberGrowth: [SubscriberGrowthSchema],
    subscribers: [SubscriberSchema],

    earnings: {
      type: EarningsSchema,
      default: () => ({}),
    },

    payoutHistory: [PayoutSchema],

    identity: IdentitySchema,
    analytics: AnalyticsSchema,
  },
  {
    timestamps: true,
  },
);

const MentorModel = mongoose.model("Mentor", MentorSchema);
export default MentorModel;