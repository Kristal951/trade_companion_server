import jwt from "jsonwebtoken";
import UserModel from "../models/User.js";

export const authenticateUser = async (req, res, next) => {
  try {
    const token = req.cookies.tradecompanion_token;
    console.log(token)
    if (!token) return res.status(401).json({ message: "Not authenticated" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await UserModel.findById(decoded.userId); 
    if (!req.user) return res.status(404).json({ message: "User not found" });

    next();
  } catch (err) {
    console.error(err);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
