import express from "express";
import { cancelSubscription, changeSubscription, confirmCheckoutSession, createBillingPortal, createCheckout, getStripeAccount, stripeWebhook } from "../controllers/Stripe.js";
import { authenticateUser } from "../middlewares/authenticateUser.js";
const router = express.Router();

router.post("/checkout", authenticateUser, createCheckout);
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);
router.post("/billing-portal", authenticateUser, createBillingPortal);
router.post("/cancel-subscription", authenticateUser, cancelSubscription);
router.get('/myaccount', getStripeAccount)
router.post('/confirm-session', authenticateUser, confirmCheckoutSession)
router.post("/change-subscription", authenticateUser, changeSubscription);


export default router;