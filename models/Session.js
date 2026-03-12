import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    ipAddress: { type: String, index: true },

    location: {
      country: String,
      city: String,
      region: String,
      isp: String,
    },

    userAgent: String,

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    revoked: {
      type: Boolean,
      default: false,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, 
    },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, revoked: 1 });

export default mongoose.model("Session", sessionSchema);
