import bcrypt from "bcryptjs"; // or 'bcrypt' if using native
import UserModel from "../models/User.js";
import {
  generateVerificationToken,
  sendForgotPasswordLinkWithResend,
  sendVerificationEmailWithResend,
  verifyGoogleToken,
} from "../utils/index.js";
import jwt from "jsonwebtoken";
import cloudinary from "../utils/cloudinary.js";
import crypto from "crypto";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import geoip from "geoip-lite";
import ms from "ms";
import Session from "../models/Session.js";
import { getClientIp } from "../utils/Token.js";

export const SignUpUser = async (req, res) => {
  try {
    const { name, email, password, age } = req.body;

    const parsedAge = Number(age);

    if (
      !name?.trim() ||
      !email?.trim() ||
      !password ||
      !Number.isInteger(parsedAge) ||
      parsedAge < 13
    ) {
      return res.status(400).json({ error: "Invalid signup data" });
    }

    const emailNorm = String(email).toLowerCase().trim();

    const existingUser = await UserModel.findOne({ email: emailNorm });
    if (existingUser) {
      return res.status(400).json({ error: "Email already in use." });
    }

    const image = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name,
    )}&background=random`;

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new UserModel({
      name: String(name).trim(),
      email: emailNorm,
      avatar: image,
      emailVerified: false,
      isGoogle: false,
      password: hashedPassword,
      age,
      isMentor: false,
      verificationCodeSentAt: new Date(),
    });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    newUser.verificationCode = code;
    await newUser.save();

    const token = jwt.sign(
      { userID: newUser._id.toString(), email: emailNorm, code },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );
    console.log(code);

    await sendVerificationEmailWithResend(emailNorm, newUser.name, code);

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("tradecompanion_token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 15 * 60 * 1000,
    });

    return res.status(201).json({
      success: true,
      message: "User registered. Please verify your email.",
    });
  } catch (error) {
    console.log("Error during registration:", error);
    return res.status(500).json({ error: "Server error" });
  }
};

export const verify_email_code = async (req, res) => {
  const { code, token: bodyToken } = req.body;

  if (!code) {
    return res.status(400).json({ error: "Verification code is required" });
  }

  const token =
    req.cookies?.tradecompanion_token ||
    bodyToken ||
    (req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null);

  if (!token) {
    return res.status(401).json({ error: "Missing verification session" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = payload?.userID || payload?.userId || payload?.id;

    if (!userId) {
      return res.status(400).json({ error: "Invalid token" });
    }

    const user = await UserModel.findById(userId).select("+password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(200).json({ message: "Email already verified" });
    }

    const submitted = String(code).trim();

    if (!user.verificationCode) {
      return res.status(400).json({
        error: "No active verification code. Please resend code.",
      });
    }

    if (user.verificationCode !== submitted) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    user.emailVerified = true;
    user.verificationCode = null;
    user.verificationCodeSentAt = null;
    await user.save();

    const sessionId = uuidv4();

    const ip = getClientIp(req);
    const geo = ip && ip !== "::1" ? geoip.lookup(ip) : null;
    const location = geo
      ? { country: geo.country, city: geo.city, region: geo.region }
      : null;

    const accessToken = jwt.sign(
      { userId: user._id.toString(), sessionId },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES },
    );

    const refreshToken = jwt.sign(
      { userId: user._id.toString(), sessionId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    await Session.create({
      sessionId,
      userId: user._id,
      refreshTokenHash,
      ipAddress: ip,
      location,
      userAgent: req.headers["user-agent"],
      expiresAt: new Date(Date.now() + ms(process.env.REFRESH_TOKEN_EXPIRES)),
    });

    const isProd = process.env.NODE_ENV === "production";

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: ms(process.env.REFRESH_TOKEN_EXPIRES),
    });

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: ms(process.env.ACCESS_TOKEN_EXPIRES),
    });

    res.clearCookie("tradecompanion_token", {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
    });

    const safeUser = {
      id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      emailVerified: user.emailVerified,
      isGoogle: user.isGoogle,
      isMentor: user.isMentor,
      age: user.age,
    };

    return res.status(200).json({
      message: "Email verified successfully",
      user: safeUser,
      accessToken,
    });
  } catch (error) {
    console.log("verify_email_code error:", error);

    if (error?.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Verification session expired. Please resend code.",
      });
    }

    return res.status(400).json({
      error: "Verification failed or token invalid",
    });
  }
};

export const LoginUser = async (req, res) => {
  const { email, password: inputPassword } = req.body;
  const sessionId = uuidv4();

  const ip = getClientIp(req);

  const geo = ip && ip !== "::1" ? geoip.lookup(ip) : null;

  const location = geo
    ? { country: geo.country, city: geo.city, region: geo.region }
    : null;

  if (!email || !inputPassword) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const emailNorm = String(email).toLowerCase().trim();
    const user = await UserModel.findOne({ email: emailNorm }).select(
      "+password",
    );

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.isGoogle) {
      return res
        .status(401)
        .json({ message: "Please login using Google for this account" });
    }

    const isValid = await bcrypt.compare(inputPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = jwt.sign(
      { userId: user._id, sessionId },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES },
    );

    const refreshToken = jwt.sign(
      { userId: user._id, sessionId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    await Session.create({
      sessionId,
      userId: user._id,
      refreshTokenHash,
      ipAddress: ip,
      location,
      userAgent: req.headers["user-agent"],
      expiresAt: Date.now() + ms(process.env.REFRESH_TOKEN_EXPIRES),
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: ms(process.env.REFRESH_TOKEN_EXPIRES),
    });

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: ms(process.env.ACCESS_TOKEN_EXPIRES),
    });

    const { password, ...userData } = user.toObject();
    console.log(userData);

    return res.status(200).json({
      message: "Login successful",
      user: userData,
      accessToken,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const SignInUserWithGoogle = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Google token is required" });
  }

  const sessionId = uuidv4();

  const ip = getClientIp(req);
  const geo = ip && ip !== "::1" ? geoip.lookup(ip) : null;
  const location = geo
    ? { country: geo.country, city: geo.city, region: geo.region }
    : null;

  try {
    const payload = await verifyGoogleToken(token);
    if (!payload) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    const { email, name, email_verified, sub, picture } = payload;

    if (!email_verified) {
      return res.status(400).json({ message: "Google email not verified" });
    }

    const emailNorm = String(email).toLowerCase().trim();
    let user = await UserModel.findOne({ email: emailNorm });

    if (!user) {
      const hashedPassword = await bcrypt.hash(sub, 10);
      user = await UserModel.create({
        name,
        email,
        isGoogle: true,
        avatar:
          picture ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(
            name,
          )}&background=random`,
        password: hashedPassword,
        age: 18,
        emailVerified: true,
        isMentor: false,
      });
    } else if (!user.isGoogle) {
      return res.status(400).json({
        message:
          "This email is already registered with a different method. Please login with email/password.",
      });
    }

    const accessToken = jwt.sign(
      { userId: user._id.toString(), sessionId },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: process.env.ACCESS_TOKEN_EXPIRES },
    );

    const refreshToken = jwt.sign(
      { userId: user._id.toString(), sessionId },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.REFRESH_TOKEN_EXPIRES },
    );

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    await Session.create({
      sessionId,
      userId: user._id,
      refreshTokenHash,
      ipAddress: ip,
      location,
      userAgent: req.headers["user-agent"],
      expiresAt: Date.now() + ms(process.env.REFRESH_TOKEN_EXPIRES),
    });

    const isProd = process.env.NODE_ENV === "production";

    // ✅ refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: ms(process.env.REFRESH_TOKEN_EXPIRES),
    });

    // ✅ access token cookie
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: ms(process.env.ACCESS_TOKEN_EXPIRES),
    });

    const { password: _pw, ...userData } = user.toObject();

    return res.status(200).json({
      message: "Google Sign-In successful",
      user: userData,
    });
  } catch (err) {
    console.error("Google Sign-In Error:", err);
    return res
      .status(500)
      .json({ message: "Internal server error during Google Sign-In" });
  }
};

export const LogoutUser = async (req, res) => {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      try {
        const decoded = jwt.verify(
          refreshToken,
          process.env.REFRESH_TOKEN_SECRET,
        );

        const { userId, sessionId } = decoded;

        if (userId && sessionId) {
          await Session.updateOne(
            { sessionId, userId },
            {
              revoked: true,
              updatedAt: new Date(),
            },
          );
        }
      } catch (err) {
        console.warn("Refresh token invalid or expired during logout");
      }
    }

    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ message: "Logout failed" });
  }
};

export const updateUser = async (req, res) => {
  try {
    const allowedFields = ["name", "bio", "age", "location"];
    const updates = {};

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (req.file) {
      const tempPath = req.file.path;
      const result = await cloudinary.uploader.upload(tempPath, {
        folder: "avatars",
      });

      updates.avatar = result.secure_url;

      try {
        await fs.unlink(tempPath);
      } catch (err) {
        console.error("Failed to delete temp file:", err);
      }
    }

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const updatedUser = await UserModel.findByIdAndUpdate(userId, updates, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!updatedUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.status(200).json({ success: true, user: updatedUser });
  } catch (err) {
    console.error("Update user error:", err);
    return res.status(500).json({ success: false, message: "Update failed" });
  }
};

export const resendVerificationCode = async (req, res) => {
  try {
    const token = req.cookies?.tradecompanion_token;

    if (!token) {
      return res
        .status(401)
        .json({ error: "Missing verification session. Please sign up again." });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res
        .status(401)
        .json({ error: "Verification session expired. Please sign up again." });
    }

    const user = await UserModel.findById(payload.userID);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.emailVerified) {
      return res.status(400).json({ error: "Email is already verified" });
    }

    const lastSent = user.verificationCodeSentAt;
    if (lastSent && Date.now() - new Date(lastSent).getTime() < 60 * 1000) {
      return res
        .status(429)
        .json({ error: "Please wait before requesting another code" });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.verificationCode = code;
    user.verificationCodeSentAt = new Date();
    await user.save();

    const newToken = jwt.sign(
      { userID: user._id.toString(), email: user.email, code },
      process.env.JWT_SECRET,
      { expiresIn: "15m" },
    );

    await sendVerificationEmailWithResend(user.email, user.name, code);

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("tradecompanion_token", newToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 15 * 60 * 1000,
    });

    return res
      .status(200)
      .json({ message: "Verification code resent successfully" });
  } catch (error) {
    console.error("Error resending verification code:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const user = await UserModel.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 3600000;

    user.resetPasswordToken = token;
    user.resetPasswordExpires = expiresAt;
    await user.save();

    const resetLink = `https://dev-tradecompanion.vercel.app/auth/reset-password/${token}`;
    await sendForgotPasswordLinkWithResend({
      to: email,
      subject: "Password Reset",
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password. Link expires in 1 hour.</p>`,
    });

    return res.json({ message: "Password reset email sent" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const user = await UserModel.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ error: "Server error. Please try again later." });
  }
};
export const getMyProfile = async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.userId).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "couldn't fetch your profile" });
  }
};
