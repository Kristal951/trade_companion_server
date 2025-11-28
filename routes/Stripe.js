import express from "express";
import { create_checkout, verify_payment } from "../controllers/Stripe.js";
const router = express.Router();

router.post("/create-checkout-session", create_checkout);
router.post("/verify-payment", verify_payment);

export default router;