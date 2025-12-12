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
} from "../controllers/User.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";
import { upload } from "../utils/index.js";

const router = express.Router();

router.post("/register", SignUpUser);
router.post("/verify_email", verify_email_code);
router.post("/login", LoginUser);
router.post("/google_login", SignInUserWithGoogle);
router.post("/logout", LogoutUser);
router.put('/update_user', authenticateUser, upload.single('avatar'), updateUser)
router.get('/resend_verification_code', authenticateUser, resendVerificationCode)
router.post('/forgot_password', forgotPassword);
router.post('/reset_password/:token', resetPassword);
export default router;
