import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    name: {
      required: true,
      type: String,
      trim: true,
    },
    image: {
      type: String,
      default:
        "https://res.cloudinary.com/dz1qj3x8h/image/upload/v1735681234/default-user.png",
      trim: true,
    },
    email: {
      required: true,
      type: String,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      required: true,
      type: String,
      minlength: 6,
    },
    age: {
      required: true,
      type: Number,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    IsGoogle: {
      type: Boolean,
      default: false,
    },
    subscription: {
      type: String,
      enum: ["free", "premium"],
      default: "free",
    },
    plan: {
      name: { type: String, enum: ["basic", "plus", "premium"], default: "basic" },
      planId: { type: String, default: null },
      method: {
        type: String,
        enum: ["stripe", "bank_transfer", null],
        default: null,
      },
      status: {
        type: String,
        enum: ["active", "inactive", "canceled", "trialing", null],
        default: null,
      },
      stripeCustomerId: { type: String, default: null },
      stripeSubscriptionId: { type: String, default: null },
      bankReference: { type: String, default: null },
      startDate: { type: Date, default: null },
      endDate: { type: Date, default: null },
    },
  },
  { 
    timestamps: true,
    discriminatorKey: "type" 
  }
);

userSchema.index({ email: 1 });
const User = model("User", userSchema);

const Mentor = User.discriminator(
  "Mentor",
  new Schema({
    expertise: { type: [String], default: [] }, 
    experienceYears: { type: Number, default: 0 },
    bio: { type: String, trim: true },
    availability: { type: String, enum: ["full-time", "part-time", "hourly"], default: "part-time" },
    mentees: [{ type: Schema.Types.ObjectId, ref: "User" }],
  })
);

const RegularUser = User.discriminator(
  "RegularUser",
  new Schema({
    interests: { type: [String], default: [] }, 
    goals: { type: String, trim: true },
    mentor: { type: Schema.Types.ObjectId, ref: "Mentor" },
  })
);

export { User, Mentor, RegularUser };
