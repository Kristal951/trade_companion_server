import express from "express";
import {
  forgotPassword,
  LoginUser,
  LogoutUser,
  resendVerificationCode,
  resetPassword,
  SignInUserWithGoogle,
  SignUpUser,
  updateUser,
  verify_email_code,
  getMyProfile,
  getUserMentorsPosts,
} from "../controllers/User.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";
import { upload } from "../utils/index.js";
import { refreshToken } from "../controllers/Auth.js";

const router = express.Router();

router.post("/register", SignUpUser);
router.post("/verify_email", verify_email_code);
router.post("/login", LoginUser);
router.post("/google_login", SignInUserWithGoogle);
router.post("/logout", authenticateUser, LogoutUser);
router.put(
  "/update_user",
  authenticateUser,
  upload.single("avatar"),
  updateUser,
);
router.get("/resend_verification_code", resendVerificationCode);
router.post("/forgot_password", forgotPassword);
router.post("/reset_password/:token", resetPassword);
router.post("/refresh_token", refreshToken);
router.get("/me", getMyProfile);
router.get("/my-mentor-posts", authenticateUser, getUserMentorsPosts);

export default router;
