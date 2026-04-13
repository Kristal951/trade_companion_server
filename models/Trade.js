import mongoose from "mongoose";

const TradeSchema = new mongoose.Schema(
  {
    userId: { type: String, index: true, required: true },

    signalId: { type: String, index: true },

    instrument: { type: String, required: true, index: true },

    type: { type: String, enum: ["BUY", "SELL"], required: true },

    entryPrice: { type: Number, required: true },

    currentPrice: { type: Number, default: 0 },

    lotSize: { type: Number, default: 1 },

    pnl: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["OPEN", "ACTIVE", "CLOSED"],
      default: "OPEN",
      index: true,
    },

    stopLoss: { type: Number, default: null },

    takeProfit: { type: Number, default: null },

    openedAt: { type: Date, default: Date.now },

    activatedAt: Date,

    closedAt: Date,

    closedBecause: {
      type: String,
      enum: ["TP_HIT", "SL_HIT", "MANUAL", "SYSTEM", null],
      default: null,
    },
  },
  { timestamps: true },
);

TradeSchema.index({ userId: 1, status: 1 });
TradeSchema.index({ instrument: 1, status: 1 });

export default mongoose.model("Trade", TradeSchema);
