const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Stripe = require("stripe");

admin.initializeApp();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const db = admin.firestore();

const INSPECTION_PRICE_CENTS = 24900;
const INSPECTION_PRICE_DISPLAY = "$249";
const CURRENCY = "aud";
const SERVICE_NAME = "Pool Safety Inspection & Certificate";

function getStripe() {
  const key = STRIPE_SECRET_KEY.value();
  if (!key) throw new Error("STRIPE_SECRET_KEY has not been configured.");
  return new Stripe(key, { apiVersion: "2025-11-17.clover" });
}

function normaliseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost)) return url;
  } catch (error) {
    return null;
  }
  return null;
}

function addCheckoutParams(url, bookingId) {
  url.searchParams.set("bookingId", bookingId);
  url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  return url.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
}

function bookingSummary(booking) {
  const date = booking.preferredDateDisplay || booking.preferredDate || "date selected";
  const time = booking.preferredTimeLabel || booking.preferredTime || "time selected";
  const address = booking.propertyAddress || "inspection property";
  return `${date}, ${time} — ${address}`;
}

exports.createBookingCheckoutSession = onCall({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [STRIPE_SECRET_KEY]
}, async (request) => {
  const bookingId = String(request.data?.bookingId || "").trim();
  const successUrl = normaliseUrl(request.data?.successUrl);
  const cancelUrl = normaliseUrl(request.data?.cancelUrl);

  if (!bookingId) {
    throw new HttpsError("invalid-argument", "Missing bookingId.");
  }
  if (!successUrl || !cancelUrl) {
    throw new HttpsError("invalid-argument", "Missing or invalid success/cancel URL.");
  }

  const bookingRef = db.collection("bookings").doc(bookingId);
  const bookingSnapshot = await bookingRef.get();

  if (!bookingSnapshot.exists) {
    throw new HttpsError("not-found", "Booking was not found.");
  }

  const booking = bookingSnapshot.data() || {};
  if (booking.paymentStatus === "paid") {
    throw new HttpsError("failed-precondition", "This booking has already been paid.");
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: bookingId,
    customer_email: booking.email || undefined,
    success_url: addCheckoutParams(successUrl, bookingId),
    cancel_url: cancelUrl.toString(),
    allow_promotion_codes: false,
    billing_address_collection: "auto",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: INSPECTION_PRICE_CENTS,
          product_data: {
            name: SERVICE_NAME,
            description: bookingSummary(booking)
          }
        }
      }
    ],
    metadata: {
      bookingId,
      serviceName: SERVICE_NAME,
      source: "irongate_booking_form"
    },
    payment_intent_data: {
      metadata: {
        bookingId,
        serviceName: SERVICE_NAME,
        source: "irongate_booking_form"
      }
    }
  });

  await bookingRef.set({
    status: "pending_payment",
    paymentStatus: "checkout_created",
    stripeCheckoutSessionId: session.id,
    stripeCheckoutUrl: session.url,
    stripeAmountTotal: INSPECTION_PRICE_CENTS,
    stripeCurrency: CURRENCY,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Created Stripe Checkout Session", { bookingId, sessionId: session.id });

  return {
    checkoutUrl: session.url,
    sessionId: session.id
  };
});

async function markCheckoutSessionPaid(session) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;
  if (!bookingId) {
    logger.warn("Stripe checkout session completed without bookingId", { sessionId: session.id });
    return;
  }

  await db.collection("bookings").doc(bookingId).set({
    status: session.payment_status === "paid" ? "confirmed" : "payment_processing",
    paymentStatus: session.payment_status || "unknown",
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
    stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || null,
    stripeAmountTotal: session.amount_total || null,
    stripeCurrency: session.currency || CURRENCY,
    paidAt: session.payment_status === "paid" ? admin.firestore.FieldValue.serverTimestamp() : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Marked booking payment from Stripe webhook", {
    bookingId,
    sessionId: session.id,
    paymentStatus: session.payment_status
  });
}

async function markCheckoutSessionExpired(session) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;
  if (!bookingId) return;

  await db.collection("bookings").doc(bookingId).set({
    status: "payment_expired",
    paymentStatus: "expired",
    stripeCheckoutSessionId: session.id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

exports.stripeWebhook = onRequest({
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]
}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method not allowed");
    return;
  }

  const stripe = getStripe();
  const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
  const signature = req.headers["stripe-signature"];

  let event;
  try {
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    logger.error("Stripe webhook signature verification failed", { message: error.message });
    res.status(400).send(`Webhook Error: ${error.message}`);
    return;
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await markCheckoutSessionPaid(event.data.object);
    }

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await markCheckoutSessionExpired(event.data.object);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error("Stripe webhook handling failed", { eventType: event.type, message: error.message });
    res.status(500).send("Webhook handler failed");
  }
});
