import express from "express";
import { authenticateUser } from "../middlewares/authenticateUser.js";
import {
  cancelMentorSubscription,
  cancelSubscription,
  changeSubscription,
  confirmCheckoutSession,
  createBillingPortal,
  createCheckout,
  getStripeAccount,
  makeStripeWebhook,
} from "../controllers/Stripe.js";

const router = express.Router();

router.post("/checkout", authenticateUser, createCheckout);
router.post("/billing-portal", authenticateUser, createBillingPortal);
router.post("/cancel", authenticateUser, cancelSubscription);
router.post("/mentor/cancel", authenticateUser, cancelMentorSubscription);
router.get("/account", authenticateUser, getStripeAccount);
router.post("/confirm-session", authenticateUser, confirmCheckoutSession);
router.post("/change-subscription", authenticateUser, changeSubscription);
router.post("/webhook", makeStripeWebhook());

export default router;
