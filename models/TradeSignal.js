import mongoose from "mongoose";

const TradeSignalSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    instrument: {
      type: String,
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
    },

    isAI: {
      type: Boolean,
      required: true,
      default: true,
    },

    entryPrice: {
      type: Number,
      required: false,
    },

    stopLoss: {
      type: Number,
      required: false,
    },

    takeProfits: {
      type: [Number],
      required: false,
    },

    executedPrice: {
      type: Number,
    },

    executedAt: {
      type: Date,
    },

    closedPrice: {
      type: Number,
    },

    closedAt: {
      type: Date,
    },

    closeReason: {
      type: String,
      enum: ["TP_HIT", "SL_HIT", "MANUAL", "EXPIRED"],
    },

    profitLoss: {
      type: Number,
    },

    isWin: {
      type: Boolean,
      default: null,
      index: true,
    },

    confidence: {
      type: Number,
      required: false,
    },

    reasoning: {
      type: String,
      required: false,
    },

    technicalReasoning: {
      type: String,
    },

    orderId: {
      type: String,
      index: true,
    },

    cTraderPositionId: {
      type: String,
      index: true,
    },

    lotSize: Number,
    riskAmount: Number,

    status: {
      type: String,
      enum: ["NEW", "EXECUTED", "PROCESSING", "CLOSED", "EXPIRED", "CANCELLED"],
      default: "NEW",
      index: true,
    },

    meta: {
      type: mongoose.Schema.Types.Mixed,
    },

    dedupeKey: {
      type: String,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

TradeSignalSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export const TradeSignal =
  mongoose.models.TradeSignal ||
  mongoose.model("TradeSignal", TradeSignalSchema);
