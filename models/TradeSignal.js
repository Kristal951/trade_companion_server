import mongoose from "mongoose";

const TradeSignalSchema = new mongoose.Schema(
  {
    // --- Ownership ---
    userId: {
      type: String,
      required: true,
      index: true,
    },

    // --- Trade Identity ---
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

    // --- Entry Setup ---
    entryPrice: {
      type: Number,
      required: true,
    },

    stopLoss: {
      type: Number,
      required: true,
    },

    takeProfits: {
      type: [Number],
      required: true,
    },

    // --- Execution Tracking ---
    executedPrice: {
      type: Number,
    },

    executedAt: {
      type: Date,
    },

    // --- Closure Tracking ---
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
      type: Number, // $ result
    },

    // ✅ WIN / LOSS FLAG
    isWin: {
      type: Boolean,
      default: null, // null until trade closes
      index: true,
    },

    // --- Signal Quality ---
    confidence: {
      type: Number,
      required: true,
    },

    reasoning: {
      type: String,
      required: true,
    },

    technicalReasoning: {
      type: String,
    },

    // --- Risk ---
    lotSize: Number,
    riskAmount: Number,

    // --- Lifecycle Status ---
    status: {
      type: String,
      enum: [
        "NEW", // Generated
        "EXECUTED", // Trade opened
        "CLOSED", // Trade finished
        "EXPIRED", // Signal invalid
        "CANCELLED", // User cancelled
      ],
      default: "NEW",
      index: true,
    },

    // --- Extras ---
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
