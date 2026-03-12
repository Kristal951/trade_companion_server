import mongoose from "mongoose";

const { Schema } = mongoose;

const MentorPostSchema = new Schema(
  {
    mentor: {
      type: Schema.Types.ObjectId,
      ref: "Mentor",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["signal", "analysis"],
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    content: {
      type: String,
      required: true,
    },

    fileURLs: [String], 

    signalDetails: {
      instrument: String,
      direction: {
        type: String,
        enum: ["BUY", "SELL"],
      },
      entry: String,
      stopLoss: String,
      takeProfit: [String],
    },
  },
  {
    timestamps: true,
  }
);

MentorPostSchema.pre("validate", function (next) {
  if (this.type === "signal" && !this.signalDetails) {
    return next(new Error("Signal posts must include signalDetails"));
  }
  next();
});

export default mongoose.model("MentorPost", MentorPostSchema);
