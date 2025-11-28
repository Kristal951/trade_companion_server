import stripePackage from "stripe";
import UserModel from "../models/User.js"; 

const stripe = stripePackage(process.env.STRIPE_SECRET_KEY);

const priceMap = {
  "basic-monthly": process.env.STRIPE_BASIC_MONTHLY,
  "basic-yearly": process.env.STRIPE_BASIC_YEARLY,
  "plus-monthly": process.env.STRIPE_PLUS_MONTHLY,
  "plus-yearly": process.env.STRIPE_PLUS_YEARLY,
  "premium-monthly": process.env.STRIPE_PREMIUM_MONTHLY,
  "premium-yearly": process.env.STRIPE_PREMIUM_YEARLY,
};

export const create_checkout = async (req, res) => {
  console.log(req.body);
  try {
    const { selectedPlan } = req.body;
    const priceId = priceMap[selectedPlan];
    console.log(selectedPlan, priceId);
    if (!priceId) {
      return res.status(400).json({ message: "Invalid plan selected" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URI}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URI}/payment-cancelled`,
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error("Checkout error:", error);
    res.status(500).json({ message: error.message });
  }
};

export const verify_payment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
      console.log(session);
      return res.json({ success: true, session });
    } else {
      console.log(session);
      return res.json({ success: false, session });
    }
  } catch (err) {
    console.error("Payment verification error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getInvoiceAndSend = async (req, res) => {
  try {
    const { invoiceId, email } = req.body;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const hostedUrl = invoice.hosted_invoice_url;
    console.log(hostedUrl);

    // Send hosted invoice link via email (example: using Nodemailer)
    // You can format it nicely in your email template
    // Example:
    // await sendEmail({
    //   to: email,
    //   subject: "Your Invoice",
    //   html: `<p>Here is your invoice: <a href="${hostedUrl}">View Invoice</a></p>`,
    // });

    // Option 2: Get PDF invoice file
    // Stripe provides a URL for the PDF as well
    const pdfUrl = invoice.invoice_pdf;

    // You can attach pdfUrl in email too:
    // await sendEmail({
    //   to: email,
    //   subject: "Your Invoice (PDF)",
    //   html: `<p>Download your invoice here: <a href="${pdfUrl}">Download PDF</a></p>`,
    // });

    return res.json({
      success: true,
      invoice,
      hostedUrl,
      pdfUrl,
    });
  } catch (error) {
    console.error("❌ Error retrieving invoice:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
};