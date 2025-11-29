import bcrypt from "bcryptjs"; // or 'bcrypt' if using native
import UserModel from "../models/User.js";
import {
  generateVerificationToken,
  sendVerificationEmail,
  verifyGoogleToken,
} from "../utils/index.js";
import jwt from "jsonwebtoken";

export const SignUpUser = async (req, res) => {
  try {
    const { name, email, password, age } = req.body;
    console.log(name, email, password, age);
    const type = "user";
    if (!name || !email || !password || !age || !type) {
      console.log("err");
      return res.status(400).json({ error: "All fields are required" });
    }
    const existingUser = await UserModel.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        error: "Email already in use, please use another email.",
      });
    }

    const image = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      name
    )}&background=random`;

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    console.log(hashedPassword);

    let newUser;

    if (type === "mentor") {
      newUser = new Mentor({
        name,
        email,
        image,
        emailVerified: false,
        IsGoogle: false,
        password: hashedPassword,
        age,
      });
    } else {
      newUser = new UserModel({
        name,
        email,
        avatar: image,
        emailVerified: false,
        IsGoogle: false,
        password: hashedPassword,
        age,
        isMentor: false,
      });
      console.log(newUser);
    }

    await newUser.save();

    const token = generateVerificationToken({
      email,
      code,
      userID: newUser._id.toString(),
    });

    try {
      await sendVerificationEmail({ to: email, name, code });
    } catch (emailError) {
      console.log("Email sending failed:", emailError.message);
    }

    res.cookie("tradecompanion_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
      sameSite: "none",
      secure: true,
    });

    const safeUser = {
      _id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      image: newUser.avatar,
      age: newUser.age,
      mentor: newUser.isMentor,
      emailVerified: newUser.emailVerified,
      plan: newUser.subscribedPlan,
    };

    res.status(201).json({
      success: true,
      user: safeUser,
    });
  } catch (error) {
    console.log("Error during user registration:", error);
    res.status(500).json({ error: `${error}` });
  }
};

export const verify_email_code = async (req, res) => {
  const { code } = req.body;
  const token = req.cookies.tradecompanion_token;

  if (!code || !token) {
    return res
      .status(400)
      .json({ error: "Verification code and token are required" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload.code || !payload.userID) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (payload.code !== code) {
      return res.status(400).json({ error: "Invalid verification code" });
    }

    const user = await User.findByIdAndUpdate(payload.userID, {
      emailVerified: true,
    });
    res.clearCookie("tradecompanion_token");

    return res
      .status(200)
      .json({ message: "Email verified successfully", user });
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Verification token has expired" });
    }

    return res
      .status(401)
      .json({ error: "Verification failed or token invalid" });
  }
};
export const LoginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({ message: "Email not verified" });
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not defined");
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("tradecompanion_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
      sameSite: "strict",
    });

    const { password: _, ...userData } = user.toObject();

    res.status(200).json({
      message: "Login successful",
      user: userData,
    });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const SignInUserWithGoogle = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Google token is required" });
  }

  try {
    const payload = await verifyGoogleToken(token);

    if (!payload) {
      return res.status(401).json({ message: "Invalid Google token" });
    }

    const { email, name, email_verified, sub, picture } = payload;

    if (!email_verified) {
      res.status(400).json({ message: "Google email not verified" });
    }

    let user = await User.findOne({ email });

    if (!user) {
      const hashedPassword = await bcrypt.hash(sub, 10);
      user = new User({
        name,
        email,
        IsGoogle: true,
        image:
          picture ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(
            name
          )}&background=random`,
        password: hashedPassword,
        age: 18,
        emailVerified: email_verified,
      });
      await user.save();
    } else if (!user.IsGoogle) {
      return res.status(400).json({
        message: "This email is already registered with a different method",
      });
    }
    const jwtToken = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie("tradecompanion_token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 1000,
      sameSite: "strict",
    });

    const { password: _, ...userData } = user.toObject();

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
    res.clearCookie("tradecompanion_token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message: "Logout failed",
    });
  }
};
