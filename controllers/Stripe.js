import Stripe from "stripe";
import UserModel from "../models/User.js";
import MentorModel from "../models/Mentor.js";
import ProcessedStripeEventModel from "../models/ProcessedStripeEvent.js";
import {
  extractIntervalFromPlanKey,
  isActiveSubscriptionStatus,
  normalizePlan,
  PLAN_NAME,
} from "../utils/index.js";
import { io } from "../server.js";
import { createAndSendNotification } from "../services/Notification.js";
import { createAndSendTelegramNotification } from "../services/Telegram.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-08-27.basil",
});

const BILLING_LINK = "/billing";
const MENTOR_BILLING_LINK = "/mentors/billing";

const priceMap = {
  "basic-monthly": process.env.STRIPE_BASIC_MONTHLY,
  "basic-yearly": process.env.STRIPE_BASIC_YEARLY,
  "pro-monthly": process.env.STRIPE_PRO_MONTHLY,
  "pro-yearly": process.env.STRIPE_PRO_YEARLY,
  "premium-monthly": process.env.STRIPE_PREMIUM_MONTHLY,
  "premium-yearly": process.env.STRIPE_PREMIUM_YEARLY,
};

const getId = (value) => {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
};

const getInvoicePeriodEnd = (invoice) => {
  const end = invoice?.lines?.data?.[0]?.period?.end;
  return end ? new Date(end * 1000) : null;
};

const buildStripeMeta = (event, extra = {}) => ({
  stripeEventId: event?.id || null,
  eventType: event?.type || null,
  ...extra,
});

const getRecipientId = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value._id || value.id || null;
};

const mapMentorSubscriptionStatus = (status, fallback = "Inactive") => {
  switch (status) {
    case "active":
      return "Active";
    case "past_due":
      return "Past Due";
    case "unpaid":
      return "Unpaid";
    case "incomplete":
      return "Incomplete";
    case "canceled":
    case "cancelled":
      return "Cancelled";
    default:
      return fallback;
  }
};

const getCurrentPeriodEndFromSubscription = (sub) => {
  return sub?.current_period_end
    ? new Date(sub.current_period_end * 1000)
    : null;
};

const findMentorBySubscriptionId = async (subscriptionId) => {
  if (!subscriptionId) return null;

  return MentorModel.findOne({
    "subscribers.stripeSubscriptionId": subscriptionId,
  });
};

const findMentorSubscriber = (mentor, subscriptionId) => {
  if (!mentor || !subscriptionId) return null;

  return mentor.subscribers.find(
    (s) => s.stripeSubscriptionId === subscriptionId,
  );
};

const notifyBilling = async ({
  io,
  recipient,
  title,
  message,
  linkTo = BILLING_LINK,
  priority = "normal",
  meta = {},
  dedupeKey = null,
}) => {
  const recipientId = getRecipientId(recipient);
  if (!recipientId) return null;

  return createAndSendNotification({
    io,
    recipient: recipientId,
    type: "billing",
    title,
    message,
    linkTo,
    priority,
    meta,
    dedupeKey,
  });
};

const updateAppSubscriptionState = async (subscriptionId, update) => {
  if (!subscriptionId) return null;

  return UserModel.findOneAndUpdate(
    { stripeSubscriptionId: subscriptionId },
    update,
    { new: true },
  );
};

const upsertMentorSubscriber = async ({
  mentorId,
  userId,
  name,
  avatar,
  stripeCustomerId,
  stripeSubscriptionId,
  status = "Active",
  subscribedDate = new Date(),
  currentPeriodEnd = null,
  lastPaidAt = null,
  endedAt = null,
}) => {
  const mentor = await MentorModel.findById(mentorId);
  if (!mentor) return null;

  const existingIndex = mentor.subscribers.findIndex(
    (s) =>
      String(s.userId) === String(userId) ||
      (stripeSubscriptionId &&
        s.stripeSubscriptionId === String(stripeSubscriptionId)),
  );

  const payload = {
    userId,
    name,
    avatar,
    stripeCustomerId,
    stripeSubscriptionId,
    subscribedDate,
    currentPeriodEnd,
    lastPaidAt,
    endedAt,
    status,
  };

  if (existingIndex >= 0) {
    const existing = mentor.subscribers[existingIndex];
    mentor.subscribers[existingIndex] = {
      ...(existing?.toObject ? existing.toObject() : existing),
      ...payload,
    };
  } else {
    mentor.subscribers.push(payload);
  }

  await mentor.save();
  return mentor;
};

const updateMentorSubscriberBySubscriptionId = async (
  stripeSubscriptionId,
  updates = {},
) => {
  if (!stripeSubscriptionId) return null;

  const mentor = await MentorModel.findOne({
    "subscribers.stripeSubscriptionId": stripeSubscriptionId,
  });

  if (!mentor) return null;

  const sub = mentor.subscribers.find(
    (s) => s.stripeSubscriptionId === stripeSubscriptionId,
  );

  if (!sub) return null;

  Object.assign(sub, updates);
  await mentor.save();

  return mentor;
};

/* -------------------------------------------------------------------------- */
/*                             Stripe event locking                           */
/* -------------------------------------------------------------------------- */

const lockStripeEvent = async (event) => {
  if (!event?.id) {
    return { shouldProcess: true };
  }

  try {
    await ProcessedStripeEventModel.create({
      eventId: event.id,
      eventType: event.type,
      status: "processing",
    });

    return { shouldProcess: true };
  } catch (error) {
    if (error?.code === 11000) {
      const existing = await ProcessedStripeEventModel.findOne({
        eventId: event.id,
      }).lean();

      if (!existing) {
        return { shouldProcess: false };
      }

      if (existing.status === "processed") {
        return { shouldProcess: false };
      }

      if (existing.status === "processing") {
        return { shouldProcess: false };
      }

      if (existing.status === "failed") {
        await ProcessedStripeEventModel.updateOne(
          { eventId: event.id },
          {
            $set: {
              status: "processing",
              lastError: null,
            },
          },
        );

        return { shouldProcess: true };
      }
    }

    throw error;
  }
};

const markStripeEventProcessed = async (eventId) => {
  if (!eventId) return;

  await ProcessedStripeEventModel.updateOne(
    { eventId },
    {
      $set: {
        status: "processed",
        processedAt: new Date(),
        lastError: null,
      },
    },
  );
};

const markStripeEventFailed = async (eventId, error) => {
  if (!eventId) return;

  await ProcessedStripeEventModel.updateOne(
    { eventId },
    {
      $set: {
        status: "failed",
        lastError: error?.message || "Unknown webhook error",
      },
    },
  );
};

/* -------------------------------------------------------------------------- */
/*                            Top-level event router                          */
/* -------------------------------------------------------------------------- */

const handleStripeWebhookEvent = async ({ event, io }) => {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted({ event, io });
      break;

    case "invoice.paid":
      await handleInvoicePaid({ event, io });
      break;

    case "invoice.payment_failed":
      await handleInvoicePaymentFailed({ event, io });
      break;

    case "customer.subscription.updated":
      await handleCustomerSubscriptionUpdated({ event, io });
      break;

    case "customer.subscription.deleted":
      await handleCustomerSubscriptionDeleted({ event, io });
      break;

    default:
      break;
  }
};

/* -------------------------------------------------------------------------- */
/*                        checkout.session.completed                          */
/* -------------------------------------------------------------------------- */

const handleCheckoutSessionCompleted = async ({ event, io }) => {
  const session = event.data.object;

  if (session.mode !== "subscription") {
    console.log("Returning early: session mode is not subscription");
    return;
  }

  const type = session.metadata?.type || "app_subscription";
  const subscriptionId = getId(session.subscription);
  const customerId = getId(session.customer);

  console.log("Checkout type:", type);
  console.log("subscriptionId:", subscriptionId);
  console.log("customerId:", customerId);

  if (type === "mentor_subscription") {
    console.log("Routing to mentor subscription handler");
    await activateMentorSubscriptionFromCheckout({
      event,
      io,
      session,
      subscriptionId,
      customerId,
    });
    return;
  }

  await activateAppSubscriptionFromCheckout({
    event,
    io,
    session,
    subscriptionId,
    customerId,
  });
};

const activateMentorSubscriptionFromCheckout = async ({
  event,
  io,
  session,
  subscriptionId,
  customerId,
}) => {
  const userId = session.metadata?.userId;
  const mentorId = session.metadata?.mentorId;

  if (!userId || !mentorId || !subscriptionId) {
    console.log("Returning early: missing userId, mentorId, or subscriptionId");
    return;
  }

  const user = await UserModel.findById(userId).select("name avatar");
  const mentor = await MentorModel.findById(mentorId).select("name avatar");

  if (!user) {
    console.log("Returning early: user not found");
    return;
  }
  if (!mentor) {
    console.log("Returning early: mentor not found");
    return;
  }

  await upsertMentorSubscriber({
    mentorId,
    userId,
    name: user.name,
    avatar: user.avatar || null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    status: "Active",
    subscribedDate: new Date(),
  });

  await notifyBilling({
    io,
    recipient: userId,
    title: "Mentor Subscription Active",
    message: `Your subscription to ${mentor.name} is now active.`,
    linkTo: MENTOR_BILLING_LINK,
    priority: "normal",
    meta: buildStripeMeta(event, {
      mentorId,
      subscriptionId,
      customerId,
      checkoutSessionId: session.id,
    }),
    dedupeKey: `billing:mentor_subscription_active:${subscriptionId}`,
  });

  await createAndSendTelegramNotification({
    recipient: userId,
    title: "Mentor Subscription Active",
    message: `Your subscription to ${mentor.name} is now active.`,
    linkTo: MENTOR_BILLING_LINK,
    priority: "normal",
    meta: buildStripeMeta(event, {
      mentorId,
      subscriptionId,
      customerId,
      checkoutSessionId: session.id,
    }),
    dedupeKey: `billing:mentor_subscription_active:${subscriptionId}:telegram:user`,
  });

  await notifyBilling({
    io,
    recipient: mentorId,
    title: "New subscriber",
    message: `${user.name} just subscribed to your plan`,
    linkTo: "/mentor/followers",
    priority: "normal",
    meta: buildStripeMeta(event, {
      mentorId,
      subscriptionId,
      customerId,
      checkoutSessionId: session.id,
      type: "info",
    }),
    dedupeKey: `billing:mentor_subscription_active:${subscriptionId}:${mentorId}`,
  });

  await createAndSendTelegramNotification({
    recipient: mentorId,
    title: "New subscriber",
    message: `${user.name} just subscribed to your plan`,
    linkTo: "/mentor/followers",
    priority: "normal",
    meta: buildStripeMeta(event, {
      mentorId,
      userId,
      subscriptionId,
      customerId,
      checkoutSessionId: session.id,
    }),
    dedupeKey: `billing:mentor_subscription_active:${subscriptionId}:telegram:mentor`,
  });
};

const activateAppSubscriptionFromCheckout = async ({
  event,
  io,
  session,
  subscriptionId,
  customerId,
}) => {
  const userId = session.metadata?.userId;
  const planKey = session.metadata?.plan || null;

  if (!userId || !subscriptionId) return;

  const subscribedPlan = normalizePlan(planKey);
  const subscriptionInterval = extractIntervalFromPlanKey(planKey);

  const user = await UserModel.findByIdAndUpdate(
    userId,
    {
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
    },
    { new: true },
  );

  if (!user) return;

  await notifyBilling({
    io,
    recipient: user._id,
    title: "Subscription Active",
    message: `Your ${subscribedPlan} plan subscription is now active.`,
    linkTo: BILLING_LINK,
    priority: "normal",
    meta: buildStripeMeta(event, {
      subscriptionId,
      customerId,
      planKey,
      subscribedPlan,
      subscriptionInterval,
      checkoutSessionId: session.id,
    }),
    dedupeKey: `billing:app_subscription_active:${subscriptionId}`,
  });
};

/* -------------------------------------------------------------------------- */
/*                                invoice.paid                                */
/* -------------------------------------------------------------------------- */

const handleInvoicePaid = async ({ event, io }) => {
  const invoice = event.data.object;
  const subscriptionId = getId(invoice.subscription);

  if (!subscriptionId) return;

  const mentor = await findMentorBySubscriptionId(subscriptionId);

  if (mentor) {
    await handleMentorInvoicePaid({
      event,
      io,
      invoice,
      subscriptionId,
      mentor,
    });
    return;
  }

  await handleAppInvoicePaid({ event, io, invoice, subscriptionId });
};

const handleMentorInvoicePaid = async ({
  event,
  io,
  invoice,
  subscriptionId,
  mentor,
}) => {
  const currentPeriodEnd = getInvoicePeriodEnd(invoice);
  const subscriber = findMentorSubscriber(mentor, subscriptionId);
  if (!subscriber) return;

  subscriber.status = "Active";
  subscriber.lastPaidAt = new Date();
  if (currentPeriodEnd) subscriber.currentPeriodEnd = currentPeriodEnd;

  await mentor.save();

  const notRes = await notifyBilling({
    io,
    recipient: subscriber.userId,
    title: "Mentor Subscription Renewed",
    message: "Your mentor subscription payment was successful.",
    linkTo: MENTOR_BILLING_LINK,
    priority: "normal",
    meta: buildStripeMeta(event, {
      subscriptionId,
      invoiceId: invoice.id,
      currentPeriodEnd,
    }),
    dedupeKey: `billing:mentor_invoice_paid:${subscriptionId}:${invoice.id}`,
  });
  console.log(notRes, "notRes");
};

const handleAppInvoicePaid = async ({ event, io, invoice, subscriptionId }) => {
  const currentPeriodEnd = getInvoicePeriodEnd(invoice);

  const user = await updateAppSubscriptionState(subscriptionId, {
    $set: {
      isSubscribed: true,
      subscriptionStatus: "active",
      ...(currentPeriodEnd && {
        subscriptionCurrentPeriodEnd: currentPeriodEnd,
      }),
    },
  });

  if (!user) return;

  await notifyBilling({
    io,
    recipient: user._id,
    title: "Subscription Payment Successful",
    message:
      "Your subscription payment was successful and your plan remains active.",
    linkTo: BILLING_LINK,
    priority: "normal",
    meta: buildStripeMeta(event, {
      subscriptionId,
      invoiceId: invoice.id,
      currentPeriodEnd,
    }),
    dedupeKey: `billing:app_invoice_paid:${subscriptionId}:${invoice.id}`,
  });
};

/* -------------------------------------------------------------------------- */
/*                           invoice.payment_failed                           */
/* -------------------------------------------------------------------------- */

const handleInvoicePaymentFailed = async ({ event, io }) => {
  const invoice = event.data.object;
  const subscriptionId = getId(invoice.subscription);

  if (!subscriptionId) return;

  const mentor = await findMentorBySubscriptionId(subscriptionId);

  if (mentor) {
    await handleMentorInvoicePaymentFailed({
      event,
      io,
      invoice,
      subscriptionId,
      mentor,
    });
    return;
  }

  await handleAppInvoicePaymentFailed({ event, io, invoice, subscriptionId });
};

const handleMentorInvoicePaymentFailed = async ({
  event,
  io,
  invoice,
  subscriptionId,
  mentor,
}) => {
  const subscriber = findMentorSubscriber(mentor, subscriptionId);
  if (!subscriber) return;

  subscriber.status = "Past Due";
  await mentor.save();

  const notRes = await notifyBilling({
    io,
    recipient: subscriber.userId,
    title: "Mentor Subscription Payment Failed",
    message:
      "We could not process your mentor subscription payment. Please update your billing method.",
    linkTo: MENTOR_BILLING_LINK,
    priority: "high",
    meta: buildStripeMeta(event, {
      subscriptionId,
      invoiceId: invoice.id,
    }),
    dedupeKey: `billing:mentor_invoice_failed:${subscriptionId}:${invoice.id}`,
  });

  console.log(notRes);
};

const handleAppInvoicePaymentFailed = async ({
  event,
  io,
  invoice,
  subscriptionId,
}) => {
  const user = await updateAppSubscriptionState(subscriptionId, {
    $set: {
      isSubscribed: false,
      subscriptionStatus: "past_due",
    },
  });

  if (!user) return;

  await notifyBilling({
    io,
    recipient: user._id,
    title: "Subscription Payment Failed",
    message:
      "We could not process your subscription payment. Please update your billing method.",
    linkTo: BILLING_LINK,
    priority: "high",
    meta: buildStripeMeta(event, {
      subscriptionId,
      invoiceId: invoice.id,
    }),
    dedupeKey: `billing:app_invoice_failed:${subscriptionId}:${invoice.id}`,
  });
};

/* -------------------------------------------------------------------------- */
/*                       customer.subscription.updated                        */
/* -------------------------------------------------------------------------- */

const handleCustomerSubscriptionUpdated = async ({ event, io }) => {
  const sub = event.data.object;
  if (!sub?.id) return;

  const mentor = await findMentorBySubscriptionId(sub.id);

  if (mentor) {
    await handleMentorSubscriptionUpdated({ event, io, sub, mentor });
    return;
  }

  await handleAppSubscriptionUpdated({ event, io, sub });
};

const handleMentorSubscriptionUpdated = async ({ event, io, sub, mentor }) => {
  const subscriber = findMentorSubscriber(mentor, sub.id);
  if (!subscriber) return;

  const previousStatus = subscriber.status;
  const mappedStatus = mapMentorSubscriptionStatus(sub.status, previousStatus);
  const currentPeriodEnd = getCurrentPeriodEndFromSubscription(sub);

  subscriber.status = mappedStatus;
  if (currentPeriodEnd) {
    subscriber.currentPeriodEnd = currentPeriodEnd;
  }

  await mentor.save();

  if (previousStatus === mappedStatus) return;

  await notifyBilling({
    io,
    recipient: subscriber.userId,
    title: "Mentor Subscription Updated",
    message: `Your mentor subscription status changed to ${mappedStatus}.`,
    linkTo: MENTOR_BILLING_LINK,
    priority:
      mappedStatus === "Past Due" ||
      mappedStatus === "Unpaid" ||
      mappedStatus === "Incomplete"
        ? "high"
        : "normal",
    meta: buildStripeMeta(event, {
      subscriptionId: sub.id,
      previousStatus,
      newStatus: mappedStatus,
      currentPeriodEnd,
    }),
    dedupeKey: `billing:mentor_status_change:${sub.id}:${previousStatus}->${mappedStatus}`,
  });
};

const handleAppSubscriptionUpdated = async ({ event, io, sub }) => {
  const existingUser = await UserModel.findOne({
    stripeSubscriptionId: sub.id,
  }).select("_id subscriptionStatus");

  if (!existingUser) return;

  const currentPeriodEnd = getCurrentPeriodEndFromSubscription(sub);

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

  if (existingUser.subscriptionStatus === sub.status) return;

  await notifyBilling({
    io,
    recipient: existingUser._id,
    title: "Subscription Updated",
    message: `Your subscription status changed to ${sub.status}.`,
    linkTo: BILLING_LINK,
    priority:
      sub.status === "past_due" ||
      sub.status === "unpaid" ||
      sub.status === "incomplete"
        ? "high"
        : "normal",
    meta: buildStripeMeta(event, {
      subscriptionId: sub.id,
      previousStatus: existingUser.subscriptionStatus,
      newStatus: sub.status,
      currentPeriodEnd,
    }),
    dedupeKey: `billing:app_status_change:${sub.id}:${existingUser.subscriptionStatus}->${sub.status}`,
  });
};

const handleCustomerSubscriptionDeleted = async ({ event, io }) => {
  const sub = event.data.object;
  if (!sub?.id) return;

  const mentor = await findMentorBySubscriptionId(sub.id);

  if (mentor) {
    await handleMentorSubscriptionDeleted({ event, io, sub, mentor });
    return;
  }

  await handleAppSubscriptionDeleted({ event, io, sub });
};

const handleMentorSubscriptionDeleted = async ({ event, io, sub, mentor }) => {
  const subscriber = findMentorSubscriber(mentor, sub.id);
  if (!subscriber) return;

  subscriber.status = "Cancelled";
  subscriber.endedAt = new Date();
  await mentor.save();

  await notifyBilling({
    io,
    recipient: subscriber.userId,
    title: "Mentor Subscription Cancelled",
    message: "Your mentor subscription has been cancelled.",
    linkTo: MENTOR_BILLING_LINK,
    priority: "high",
    meta: buildStripeMeta(event, {
      subscriptionId: sub.id,
      endedAt: subscriber.endedAt,
    }),
    dedupeKey: `billing:mentor_subscription_deleted:${sub.id}`,
  });
};

const handleAppSubscriptionDeleted = async ({ event, io, sub }) => {
  const user = await updateAppSubscriptionState(sub.id, {
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
  });

  if (!user) return;

  await notifyBilling({
    io,
    recipient: user._id,
    title: "Subscription Cancelled",
    message:
      "Your subscription has ended and your account has been moved to the free plan.",
    linkTo: BILLING_LINK,
    priority: "high",
    meta: buildStripeMeta(event, {
      subscriptionId: sub.id,
    }),
    dedupeKey: `billing:app_subscription_deleted:${sub.id}`,
  });
};

export const createCheckout = async (req, res) => {
  try {
    const { selectedPlan } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    const priceId = priceMap[selectedPlan];
    if (!priceId) {
      return res.status(400).json({ message: "Invalid plan selected" });
    }

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
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        type: "app_subscription",
        userId: user._id.toString(),
        plan: selectedPlan,
      },
      subscription_data: {
        metadata: {
          type: "app_subscription",
          userId: user._id.toString(),
          plan: selectedPlan,
        },
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

export const makeStripeWebhook = () => {
  console.log("🔥 Stripe webhook hit");
  return async (req, res) => {
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
      const lock = await lockStripeEvent(event);

      if (!lock.shouldProcess) {
        return res.json({
          received: true,
          duplicate: true,
          eventId: event.id,
        });
      }

      await handleStripeWebhookEvent({ event, io });
      await markStripeEventProcessed(event.id);

      return res.json({ received: true });
    } catch (err) {
      console.error("❌ Stripe webhook handler error:", err);
      await markStripeEventFailed(event?.id, err);
      return res.status(500).json({ message: "Webhook handler failed" });
    }
  };
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

/**
 * APP SUBSCRIPTION CANCEL
 */
export const cancelSubscription = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = await UserModel.findById(userId);

    if (!user || !user.stripeSubscriptionId) {
      return res.status(400).json({ message: "No active subscription" });
    }

    await stripe.subscriptions.update(user.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    return res.json({
      success: true,
      message: "Subscription will cancel at period end",
    });
  } catch (error) {
    console.error("❌ Cancel subscription error:", error);
    return res.status(500).json({ message: error.message });
  }
};

/**
 * OPTIONAL: MENTOR SUBSCRIPTION CANCEL
 */
export const cancelMentorSubscription = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { mentorId } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    if (!mentorId) {
      return res.status(400).json({ message: "Mentor ID is required" });
    }

    const mentor = await MentorModel.findById(mentorId);
    if (!mentor) {
      return res.status(404).json({ message: "Mentor not found" });
    }

    const subscriber = mentor.subscribers.find(
      (s) => String(s.userId) === String(userId) && s.status === "Active",
    );

    if (!subscriber?.stripeSubscriptionId) {
      return res
        .status(404)
        .json({ message: "Active mentor subscription not found" });
    }

    await stripe.subscriptions.update(subscriber.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    return res.json({
      success: true,
      message: "Mentor subscription will cancel at period end",
    });
  } catch (error) {
    console.error("cancelMentorSubscription error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const getStripeAccount = async (req, res) => {
  try {
    const account = await stripe.accounts.retrieve();

    return res.json({
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
    return res.status(500).json({ message: err.message });
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

    const stripeCustomerId = getId(session.customer);

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
      message: `Plan changed to ${normalizedPlan} (${interval}ly)`,
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
