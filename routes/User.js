import express from "express";
import {
  LoginUser,
  LogoutUser,
  SignInUserWithGoogle,
  SignUpUser,
  updateUser,
  verify_email_code,
} from "../controllers/User.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";

const router = express.Router();

router.post("/register", SignUpUser);
router.post("/verify-email", verify_email_code);
router.post("/login", LoginUser);
router.post("/google_login", SignInUserWithGoogle);
router.post("/logout", LogoutUser);
router.put('/update_user', authenticateUser, updateUser)

export default router;
