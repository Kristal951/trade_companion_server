import Mentor from "../models/Mentor.js";
import MentorPost from "../models/MentorPost.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import cloudinary from "../utils/cloudinary.js";
import Stripe from "stripe";
import UserModel from "../models/User.js";
import MentorModel from "../models/Mentor.js";
import { createAndSendManyNotifications } from "../services/Notification.js";

import { sendMentorPostTelegramAlerts } from "../services/Telegram.js";
import { getIO } from "../sockets/io.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createMentor = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { experience, profitRatio, roi, price, instruments, strategy } =
      req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (!Number(price))
      return res.status(404).json({ message: "Invalid Price" });

    if (user.isMentor) {
      return res.status(400).json({ message: "Already a mentor" });
    }

    const existingMentor = await Mentor.findOne({ user: user._id });
    if (existingMentor) {
      return res.status(400).json({ message: "User is already a mentor" });
    }

    const mentor = await Mentor.create({
      user: user._id,
      avatar: user.avatar,
      email: user.email,
      name: user.name,
      experience,
      profitRatio,
      roi,
      price,
      instruments,
      strategy,
      subscribers: [],
      analytics: {
        earningsData: [],
        subscriberData: [],
        ratingDistribution: [],
        topSignals: [],
      },
    });

    const product = await stripe.products.create({
      name: `Mentor Subscription - ${mentor.name}`,
      description: `Monthly subscription to ${mentor.name}'s signals`,
      metadata: { mentorId: mentor._id.toString() },
    });

    const priceObj = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: Math.round(Number(mentor.price) * 100),
      recurring: { interval: "month" },
      metadata: { mentorId: mentor._id.toString() },
    });

    mentor.stripeProductId = product.id;
    mentor.stripePriceId = priceObj.id;
    await mentor.save();

    user.isMentor = true;
    user.mentorID = mentor._id;
    await user.save();

    return res.status(201).json({
      message: "Mentor profile created",
      mentor,
    });
  } catch (error) {
    console.error("Create mentor error:", error);
    return res.status(500).json({ message: "Failed to create mentor profile" });
  }
};

export const getMentorByUserID = async (req, res) => {
  const { userId } = req.params;

  try {
    if (!userId) throw new Error("User ID not provided in headers");

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error("Invalid User ID format");
    }

    const mentor = await Mentor.findOne({
      user: new mongoose.Types.ObjectId(userId),
    });

    if (!mentor) {
      return { success: false, message: "Mentor not found" };
    }

    return res.status(200).json({ success: true, mentor });
  } catch (error) {
    console.error("Error fetching mentor:", error.message);
    return res.status(500).json({
      message: "Failed to get mentor profile",
    });
  }
};

export const createMentorPost = async (req, res) => {
  const { mentorID, title, content, type, signalDetails } = req.body;
  const files = req.files;

  let parsedSignalDetails = null;

  if (type === "signal") {
    if (!signalDetails) {
      return res.status(400).json({ message: "signalDetails required" });
    }

    try {
      parsedSignalDetails =
        typeof signalDetails === "string"
          ? JSON.parse(signalDetails)
          : signalDetails;

      if (
        !parsedSignalDetails.takeProfit ||
        !Array.isArray(parsedSignalDetails.takeProfit) ||
        parsedSignalDetails.takeProfit.some((tp) => !tp)
      ) {
        return res.status(400).json({
          message: "All Take Profit levels must be filled",
        });
      }
    } catch (err) {
      return res.status(400).json({ message: "Invalid signalDetails format" });
    }
  }

  if (!mentorID || !type || !title || !content) {
    return res.status(400).json({ message: "Required parameters missing" });
  }

  if (!mongoose.Types.ObjectId.isValid(mentorID)) {
    return res.status(400).json({ message: "Invalid Mentor ID" });
  }

  try {
    const mentor = await MentorModel.findById(mentorID).select(
      "_id name subscribers user",
    );

    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }

    const fileURLs = [];

    if (files && files.length > 0) {
      for (const file of files) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: "mentor_posts",
        });
        fileURLs.push(result.secure_url);
      }
    }

    const postData = {
      mentor: new mongoose.Types.ObjectId(mentorID),
      type,
      title,
      content,
      fileURLs,
    };

    if (type === "signal") {
      postData.signalDetails = parsedSignalDetails;
    }

    const post = await MentorPost.create(postData);

    const activeSubscribers =
      mentor.subscribers?.filter((sub) => sub.status === "Active") || [];

    if (activeSubscribers.length > 0) {
      const payloads = activeSubscribers.map((subscriber) => ({
        recipient: String(subscriber.userId),
        type: type === "signal" ? "signal" : "mentor_post",
        title:
          type === "signal"
            ? `New signal from ${mentor.name}`
            : `New post from ${mentor.name}`,
        message:
          type === "signal"
            ? `${mentor.name} shared a new trading signal: ${title}`
            : `${mentor.name} published a new post: ${title}`,
        linkTo: `/mentor/${mentor._id}`,
        priority: type === "signal" ? "high" : "normal",
        meta: {
          mentorId: String(mentor._id),
          postId: String(post._id),
          postType: type,
          ...(type === "signal" && parsedSignalDetails
            ? {
                instrument: parsedSignalDetails.instrument || null,
                direction: parsedSignalDetails.direction || null,
              }
            : {}),
        },
        dedupeKey: `mentor_post:${post._id}:user:${subscriber.userId}`,
      }));

      const io = getIO();

      await createAndSendManyNotifications({
        io,
        payloads,
      });

      await sendMentorPostTelegramAlerts({
        subscriberIds: activeSubscribers.map((sub) => sub.userId),
        mentor,
        post,
        signalDetails: parsedSignalDetails,
      });
    }

    return res.status(201).json({
      message: "Post created",
      post,
    });
  } catch (error) {
    console.error("Error creating mentor post:", error);
    return res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

export const getAllMentorPostForAMentor = async (req, res) => {
  try {
    const { mentorId } = req.params;

    if (!mentorId) {
      return res.status(400).json({ message: "mentorId is required" });
    }

    const posts = await MentorPost.find({ mentor: mentorId }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      posts,
    });
  } catch (error) {
    console.error("Error fetching mentor posts:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch mentor posts",
    });
  }
};

export const getAllMentors = async (req, res) => {
  try {
    const mentors = await Mentor.find({})
      .select("-password -refreshToken -__v")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: mentors.length,
      mentors,
    });
  } catch (error) {
    console.error("Get mentors error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch mentors",
    });
  }
};
export const updateMentor = async (req, res) => {
  const { mentorId } = req.params;

  try {
    if (!mentorId) {
      return res.status(400).json({ message: "Mentor ID is required" });
    }

    const { name, strategy, instruments, certifications } = req.body;
    const updateFields = {};

    if (name) updateFields.name = name;
    if (strategy) updateFields.strategy = strategy;
    if (instruments) updateFields.instruments = JSON.parse(instruments);

    let certMeta = [];
    if (certifications) {
      certMeta = JSON.parse(certifications);
    }

    if (req.files) {
      if (req.files.profileImage) {
        const profileResult = await cloudinary.uploader.upload(
          req.files.profileImage[0].path,
          { folder: "mentor_profile" },
        );
        updateFields.profileImage = profileResult.secure_url;
      }

      if (req.files.certifications) {
        const uploadedCerts = [];
        for (let i = 0; i < req.files.certifications.length; i++) {
          const file = req.files.certifications[i];
          const result = await cloudinary.uploader.upload(file.path, {
            folder: "mentor_certifications",
          });

          uploadedCerts.push({
            ...(certMeta[i] || {}),
            url: result.secure_url,
          });
        }

        const mentor = await Mentor.findById(mentorId);
        updateFields.certifications = [
          ...(mentor.certifications || []),
          ...uploadedCerts,
        ];
      }
    }

    const updatedMentor = await Mentor.findByIdAndUpdate(
      mentorId,
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    if (!updatedMentor)
      return res.status(404).json({ message: "Mentor not found" });

    res.status(200).json({ mentor: updatedMentor });
  } catch (error) {
    console.error("Error updating mentor:", error);
    res.status(500).json({ message: "Failed to update mentor", error });
  }
};

export const deleteMentorPost = async (req, res) => {
  const { postID } = req.params;

  if (!postID) {
    return res.status(400).json({ message: "Post ID is required" });
  }

  try {
    const deletedPost = await MentorPost.findByIdAndDelete(postID);

    if (!deletedPost) {
      return res.status(404).json({ message: "Post not found" });
    }

    res.status(200).json({ message: "Post deleted successfully" });
  } catch (error) {
    console.error("Error deleting post:", error);
    res.status(500).json({ message: "Failed to delete post", error });
  }
};
export const editMentorPost = async (req, res) => {
  const { postID } = req.params;

  if (!postID) {
    return res.status(400).json({ message: "Post ID is required" });
  }

  try {
    const { title, content, type, signalDetails, existingFiles } = req.body;

    const updateFields = {};

    if (title) updateFields.title = title;
    if (content) updateFields.content = content;
    if (type) updateFields.type = type;
    if (signalDetails) {
      updateFields.signalDetails = JSON.parse(signalDetails);
    }

    let remainingFiles = [];
    if (existingFiles) {
      remainingFiles = JSON.parse(existingFiles);
    }

    const post = await MentorPost.findById(postID);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    let newFileURLs = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const result = await cloudinary.uploader.upload(file.path, {
          folder: "mentor_posts",
        });
        newFileURLs.push(result.secure_url);
      }
    }

    const deletedFiles = post.fileURLs.filter(
      (url) => !remainingFiles.includes(url),
    );

    for (const url of deletedFiles) {
      const publicId = url
        .split("/")
        .slice(-2)
        .join("/")
        .replace(/\.[^/.]+$/, "");

      await cloudinary.uploader.destroy(publicId);
    }

    updateFields.fileURLs = [...remainingFiles, ...newFileURLs];

    const updatedPost = await MentorPost.findByIdAndUpdate(
      postID,
      { $set: updateFields },
      { new: true, runValidators: true },
    );

    res.status(200).json({
      message: "Post updated successfully",
      post: updatedPost,
    });
  } catch (error) {
    console.error("Error updating post:", error);
    res.status(500).json({
      message: "Failed to update post",
      error: error.message,
    });
  }
};
export const getMentorByID = async (req, res) => {
  const { mentorID } = req.params;

  if (!mentorID) {
    return res.status(400).json({
      message: "Mentor ID is required",
    });
  }

  try {
    const mentor = await Mentor.findById(mentorID)
      .populate({
        path: "posts",
        options: { sort: { createdAt: -1 } },
      })
      .exec();
    if (!mentor) {
      return res.status(404).json({
        message: "Mentor not found",
      });
    }

    res.status(200).json({ mentor });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Failed to get mentor",
      error: error.message,
    });
  }
};
export const submitReview = async (req, res) => {
  const { mentorId } = req.params;
  const { rating, review } = req.body;
  const auth = req.user;
  const userId = auth.userId;

  try {
    const mentor = await Mentor.findById(mentorId);
    if (!mentor) return res.status(404).json({ message: "Mentor not found" });

    const existingReview = mentor.reviews.find(
      (r) => r.user.toString() === userId.toString(),
    );
    if (existingReview)
      return res
        .status(400)
        .json({ message: "You already reviewed this mentor" });

    const newReview = { user: userId, rating, review };
    mentor.reviews.push(newReview);
    mentor.reviewsCount = mentor.reviews.length;

    const total = mentor.reviews.reduce((acc, r) => acc + r.rating, 0);
    mentor.rating = total / mentor.reviews.length;

    await mentor.save();

    res.status(201).json({ message: "Review submitted", review: newReview });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

export const createMentorCheckout = async (req, res) => {
  try {
    const { mentorId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!mentorId || !mentorId.trim?.()) {
      return res.status(400).json({ message: "Mentor ID is required" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const mentor = await MentorModel.findById(mentorId);
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }

    if (!mentor.stripePriceId) {
      return res.status(400).json({ message: "Mentor Stripe price not set" });
    }

    if (String(mentor.user) === String(user._id)) {
      return res
        .status(400)
        .json({ message: "You can't subscribe to yourself" });
    }

    const alreadyActive = mentor.subscribers?.some(
      (s) => String(s.userId) === String(user._id) && s.status === "Active",
    );

    if (alreadyActive) {
      return res.status(400).json({ message: "Already subscribed" });
    }

    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() },
      });

      stripeCustomerId = customer.id;
      user.stripeCustomerId = stripeCustomerId;
      await user.save();
    }

    const FRONTEND = process.env.FRONTEND_BASE_URL;
    if (!FRONTEND) {
      return res
        .status(500)
        .json({ message: "FRONTEND_BASE_URL is not configured" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: mentor.stripePriceId, quantity: 1 }],
      metadata: {
        type: "mentor_subscription",
        userId: user._id.toString(),
        mentorId: mentor._id.toString(),
      },
      subscription_data: {
        metadata: {
          type: "mentor_subscription",
          userId: user._id.toString(),
          mentorId: mentor._id.toString(),
        },
      },
      success_url: `${FRONTEND}/mentor/${mentor._id}?sub=success`,
      cancel_url: `${FRONTEND}/mentor/${mentor._id}?sub=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error("createMentorCheckout error:", err);
    return res.status(500).json({ message: err.message });
  }
};
const getMonthKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};

export const updateSubscriberGrowth = async ({ mentorId, increment = 1 }) => {
  if (!mentorId) throw new Error("mentorId is required");

  const month = getMonthKey();

  const mentor = await MentorModel.findById(mentorId);
  if (!mentor) throw new Error("Mentor not found");

  if (!mentor.subscriberGrowth) {
    mentor.subscriberGrowth = [];
  }

  const existing = mentor.subscriberGrowth.find((g) => g.month === month);

  if (existing) {
    existing.subscribers += increment;
    if (existing.subscribers < 0) existing.subscribers = 0;
  } else {
    mentor.subscriberGrowth.push({
      month,
      subscribers: Math.max(increment, 0),
    });
  }

  await mentor.save();

  return mentor.subscriberGrowth;
};
