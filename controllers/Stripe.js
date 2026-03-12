import Stripe from "stripe";
import UserModel from "../models/User.js";
import {
  extractIntervalFromPlanKey,
  isActiveSubscriptionStatus,
  normalizePlan,
  PLAN_NAME,
} from "../utils/index.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Price mapping
 */
const priceMap = {
  "basic-monthly": process.env.STRIPE_BASIC_MONTHLY,
  "basic-yearly": process.env.STRIPE_BASIC_YEARLY,
  "plus-monthly": process.env.STRIPE_PLUS_MONTHLY,
  "plus-yearly": process.env.STRIPE_PLUS_YEARLY,
  "premium-monthly": process.env.STRIPE_PREMIUM_MONTHLY,
  "premium-yearly": process.env.STRIPE_PREMIUM_YEARLY,
};

export const createCheckout = async (req, res) => {
  try {
    const { selectedPlan } = req.body;

    const auth = req.user;
    const userId = auth?.userId;

    if (!userId) return res.status(401).json({ message: "Not authenticated" });

    const user = await UserModel.findById(userId);
    if (!user) return res.status(401).json({ message: "User not found" });

    const priceId = priceMap[selectedPlan];
    if (!priceId)
      return res.status(400).json({ message: "Invalid plan selected" });

    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() },
      });

      stripeCustomerId = customer.id;

      await UserModel.findByIdAndUpdate(user._id, { stripeCustomerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      // automatic_payment_methods: { enabled: true },
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        userId: user._id.toString(),
        plan: selectedPlan,
      },
      success_url: `${process.env.FRONTEND_BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_BASE_URL}/payment-cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("❌ Stripe checkout error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("❌ Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        if (session.mode !== "subscription") break;

        const userId = session.metadata?.userId;
        const planKey = session.metadata?.plan || null;

        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id || null;

        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id || null;

        if (!userId || !subscriptionId) break;

        const subscribedPlan = normalizePlan(planKey);
        const subscriptionInterval = extractIntervalFromPlanKey(planKey);

        await UserModel.findByIdAndUpdate(userId, {
          subscribedPlan,
          isSubscribed: true,
          subscriptionMethod: "stripe",
          subscriptionStatus: "active",
          subscriptionPriceKey: planKey,
          subscriptionInterval,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscriptionId,
          stripeCheckoutSessionId: session.id,
          subscriptionStartedAt: new Date(),
        });

        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || null;

        if (!subscriptionId) break;

        const currentPeriodEnd = invoice.lines?.data?.[0]?.period?.end
          ? new Date(invoice.lines.data[0].period.end * 1000)
          : null;

        await UserModel.updateOne(
          { stripeSubscriptionId: subscriptionId },
          {
            $set: {
              isSubscribed: true,
              subscriptionStatus: "active",
              ...(currentPeriodEnd && {
                subscriptionCurrentPeriodEnd: currentPeriodEnd,
              }),
            },
          },
        );

        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;

        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || null;

        if (!subscriptionId) break;

        await UserModel.updateOne(
          { stripeSubscriptionId: subscriptionId },
          {
            $set: {
              isSubscribed: false,
              subscriptionStatus: "past_due",
            },
          },
        );

        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object;

        if (!sub?.id) break;

        const currentPeriodEnd = sub.current_period_end
          ? new Date(sub.current_period_end * 1000)
          : null;

        await UserModel.updateOne(
          { stripeSubscriptionId: sub.id },
          {
            $set: {
              subscriptionStatus: sub.status,
              isSubscribed: isActiveSubscriptionStatus(sub.status),
              subscriptionCurrentPeriodEnd: currentPeriodEnd,
            },
          },
        );

        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;

        if (!sub?.id) break;

        await UserModel.updateOne(
          { stripeSubscriptionId: sub.id },
          {
            $set: {
              subscribedPlan: PLAN_NAME.FREE,
              isSubscribed: false,
              subscriptionStatus: "canceled",
              subscriptionMethod: null,
              subscriptionPriceKey: null,
              subscriptionInterval: null,
              subscriptionCurrentPeriodEnd: null,
              stripeSubscriptionId: null,
            },
          },
        );

        break;
      }

      default:
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Stripe webhook handler error:", err);
    return res.status(500).json({ message: "Webhook handler failed" });
  }
};

export const createBillingPortal = async (req, res) => {
  try {
    const userId = req.user?.userId;

    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ message: "No Stripe customer found" });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.FRONTEND_BASE_URL}/dashboard`,
    });

    return res.json({ url: portalSession.url });
  } catch (error) {
    console.error("❌ Billing portal error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const cancelSubscription = async (req, res) => {
  try {
    const user = req.user;

    if (!user.stripeSubscriptionId) {
      return res.status(400).json({ message: "No active subscription" });
    }

    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    res.json({
      success: true,
      message: "Subscription will cancel at period end",
    });
  } catch (error) {
    console.error("❌ Cancel subscription error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const getStripeAccount = async (req, res) => {
  try {
    const account = await stripe.accounts.retrieve();

    res.json({
      id: account.id,
      email: account.email,
      country: account.country,
      businessType: account.business_type,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      defaultCurrency: account.default_currency,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

export const confirmCheckoutSession = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!sessionId) {
      return res.status(400).json({ message: "sessionId is required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription"],
    });

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.metadata?.userId !== String(userId)) {
      return res
        .status(403)
        .json({ message: "This session does not belong to you" });
    }

    const subscription = session.subscription;

    if (!subscription) {
      await UserModel.findByIdAndUpdate(userId, {
        stripeCheckoutSessionId: session.id,
        subscriptionPriceKey: session.metadata?.plan || null,
        subscribedPlan: normalizePlan(session.metadata?.plan),
        subscriptionMethod: "stripe",
      });

      return res.status(200).json({
        status: "processing",
        message: "Subscription is still being created",
        subscription: {
          sessionId: session.id,
          stripePlan: session.metadata?.plan || null,
          appPlan: normalizePlan(session.metadata?.plan),
          method: "stripe",
        },
      });
    }

    const stripePlanKey = session.metadata?.plan || null;
    const appPlan = normalizePlan(stripePlanKey);
    const interval = extractIntervalFromPlanKey(stripePlanKey);
    const isSubscribed = isActiveSubscriptionStatus(subscription.status);

    const stripeCustomerId =
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id || null;

    const subscriptionCurrentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null;

    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      {
        subscribedPlan: appPlan,
        isSubscribed,
        subscriptionStatus: subscription.status,
        subscriptionMethod: "stripe",
        subscriptionPriceKey: stripePlanKey,
        subscriptionInterval: interval,
        subscriptionCurrentPeriodEnd,
        stripeCustomerId,
        stripeSubscriptionId: subscription.id,
        stripeCheckoutSessionId: session.id,
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json({
      status: isSubscribed ? "active" : "processing",
      message: isSubscribed
        ? "Subscription confirmed successfully"
        : "Subscription is still processing",
      subscription: {
        // id: subscription.id,
        // sessionId: session.id,
        status: subscription.status,
        stripePlan: stripePlanKey,
        appPlan: updatedUser.subscribedPlan,
        interval: updatedUser.subscriptionInterval,
        method: updatedUser.subscriptionMethod,
        currentPeriodEnd: updatedUser.subscriptionCurrentPeriodEnd,
      },
    });
  } catch (error) {
    console.error("confirmCheckoutSession error:", error);
    return res.status(500).json({ message: "Failed to confirm session" });
  }
};

export const changeSubscription = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { planName, billingCycle, selectedPlan } = req.body;
    console.log(planName, billingCycle, selectedPlan)

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await UserModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.stripeCustomerId || !user.stripeSubscriptionId) {
      return res.status(400).json({
        message: "No active Stripe subscription found for this user",
      });
    }

    let planKey = selectedPlan;

    if (!planKey) {
      if (!planName || !billingCycle) {
        return res.status(400).json({
          message:
            "Provide either selectedPlan or both planName and billingCycle",
        });
      }

      planKey = `${String(planName).toLowerCase()}-${String(
        billingCycle,
      ).toLowerCase()}`;
    }

    const priceId = priceMap[planKey];

    if (!priceId) {
      return res.status(400).json({ message: "Invalid plan selected" });
    }

    const normalizedPlan = normalizePlan(planKey);
    const interval = extractIntervalFromPlanKey(planKey);

    if (!normalizedPlan || !interval) {
      return res.status(400).json({ message: "Invalid plan format" });
    }

    if (normalizedPlan === PLAN_NAME.FREE || normalizedPlan === "Free") {
      return res.status(400).json({
        message: "Use cancel subscription flow to move to free plan",
      });
    }

    const currentSubscription = await stripe.subscriptions.retrieve(
      user.stripeSubscriptionId,
      {
        expand: ["items.data.price"],
      },
    );

    if (!currentSubscription || !currentSubscription.items?.data?.length) {
      return res.status(400).json({
        message: "Subscription is invalid or has no items",
      });
    }

    const subscriptionItem = currentSubscription.items.data[0];

    if (subscriptionItem.price?.id === priceId) {
      return res.status(200).json({
        message: "You are already subscribed to this plan",
        subscription: {
          status: currentSubscription.status,
          stripePlan: user.subscriptionPriceKey,
          appPlan: user.subscribedPlan,
          interval: user.subscriptionInterval,
          method: user.subscriptionMethod,
          currentPeriodEnd: user.subscriptionCurrentPeriodEnd,
        },
      });
    }

    const updatedSubscription = await stripe.subscriptions.update(
      currentSubscription.id,
      {
        items: [
          {
            id: subscriptionItem.id,
            price: priceId,
          },
        ],
        proration_behavior: "create_prorations",
      },
    );

    const subscriptionCurrentPeriodEnd = updatedSubscription.current_period_end
      ? new Date(updatedSubscription.current_period_end * 1000)
      : null;

    const isSubscribed = isActiveSubscriptionStatus(updatedSubscription.status);

    const updatedUser = await UserModel.findByIdAndUpdate(
      userId,
      {
        subscribedPlan: normalizedPlan,
        isSubscribed,
        subscriptionStatus: updatedSubscription.status,
        subscriptionMethod: "stripe",
        subscriptionPriceKey: planKey,
        subscriptionInterval: interval,
        subscriptionCurrentPeriodEnd,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: updatedSubscription.id,
      },
      {
        new: true,
        runValidators: true,
      },
    );

    return res.status(200).json({
      message: `Plan changed to ${normalizedPlan} (${interval})`,
      subscription: {
        status: updatedSubscription.status,
        stripePlan: planKey,
        appPlan: updatedUser?.subscribedPlan,
        interval: updatedUser?.subscriptionInterval,
        method: updatedUser?.subscriptionMethod,
        currentPeriodEnd: updatedUser?.subscriptionCurrentPeriodEnd,
      },
      user: updatedUser,
    });
  } catch (error) {
    console.error("changeSubscription error:", error);
    return res.status(500).json({
      message: error.message || "Failed to change subscription",
    });
  }
};
