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

  if (!key) {
    throw new Error("STRIPE_SECRET_KEY has not been configured.");
  }

  return new Stripe(key, {
    apiVersion: "2025-11-17.clover"
  });
}

function normaliseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const isLocalhost = ["localhost", "127.0.0.1"].includes(url.hostname);

    if (url.protocol === "https:" || (url.protocol === "http:" && isLocalhost)) {
      return url;
    }
  } catch (error) {
    return null;
  }

  return null;
}

function cleanText(value, maxLength = 140) {
  return String(value || "").trim().slice(0, maxLength);
}

function normaliseAgencyCode(value) {
  return cleanText(value, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function addCheckoutParams(url, bookingId) {
  url.searchParams.set("bookingId", bookingId);
  url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");

  return url
    .toString()
    .replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}");
}

function bookingSummary(booking) {
  const date = booking.preferredDateDisplay || booking.preferredDate || "date selected";
  const time = booking.preferredTimeLabel || booking.preferredTime || "time selected";
  const address = booking.propertyAddress || "inspection property";

  return `${date}, ${time} — ${address}`;
}

function getBookingContext(data = {}) {
  const context = data.bookingContext || data || {};
  const customerType = cleanText(context.customerType || "homeowner", 40);
  const agencyPartnerCode = normaliseAgencyCode(context.agencyPartnerCode || "");

  return {
    customerType: customerType === "agent" ? "agent" : "homeowner",
    bookingRole: cleanText(context.bookingRole || "", 80),
    agencyName: cleanText(context.agencyName || "", 160),
    agentName: cleanText(context.agentName || "", 120),
    agentEmail: cleanText(context.agentEmail || "", 160),
    agentPhone: cleanText(context.agentPhone || "", 40),
    ownerName: cleanText(context.ownerName || "", 120),
    ownerEmail: cleanText(context.ownerEmail || "", 160),
    ownerPhone: cleanText(context.ownerPhone || "", 40),
    agencyJobReference: cleanText(context.agencyJobReference || "", 120),
    agencyPartnerCode,
    requestedPaymentMethod: cleanText(context.requestedPaymentMethod || "pay_now", 40)
  };
}

function removeEmptyValues(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== "" && item !== null && item !== undefined));
}

async function applyBookingContext(bookingRef, context = {}) {
  const cleanContext = removeEmptyValues({
    customerType: context.customerType,
    bookingRole: context.bookingRole,
    agencyName: context.agencyName,
    agentName: context.agentName,
    agentEmail: context.agentEmail,
    agentPhone: context.agentPhone,
    ownerName: context.ownerName,
    ownerEmail: context.ownerEmail,
    ownerPhone: context.ownerPhone,
    agencyJobReference: context.agencyJobReference,
    agencyPartnerCode: context.agencyPartnerCode,
    requestedPaymentMethod: context.requestedPaymentMethod
  });

  if (Object.keys(cleanContext).length) {
    await bookingRef.set({
      ...cleanContext,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
}

async function findAgencyPartner(code) {
  const agencyPartnerCode = normaliseAgencyCode(code);
  if (!agencyPartnerCode) return null;

  const candidates = [agencyPartnerCode, agencyPartnerCode.toLowerCase()];
  for (const id of candidates) {
    const snapshot = await db.collection("agencyPartners").doc(id).get();
    if (snapshot.exists) {
      return { id: snapshot.id, code: agencyPartnerCode, data: snapshot.data() || {} };
    }
  }

  return null;
}

function assertApprovedAgencyPartner(partner) {
  if (!partner) {
    throw new HttpsError("permission-denied", "Agency invoice account was not found. Please pay now or contact IronGate.");
  }

  const data = partner.data || {};
  if (data.status !== "active" || data.invoiceAccountEnabled !== true) {
    throw new HttpsError("permission-denied", "This agency code is not approved for invoice bookings. Please pay now or contact IronGate.");
  }
}

exports.createBookingCheckoutSession = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
    secrets: [STRIPE_SECRET_KEY]
  },
  async (request) => {
    const bookingId = String(request.data?.bookingId || "").trim();
    const successUrl = normaliseUrl(request.data?.successUrl);
    const cancelUrl = normaliseUrl(request.data?.cancelUrl);
    const context = getBookingContext(request.data || {});

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

    await applyBookingContext(bookingRef, context);

    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: bookingId,
      customer_email: booking.email || context.agentEmail || undefined,
      success_url: addCheckoutParams(successUrl, bookingId),
      cancel_url: cancelUrl.toString(),
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: INSPECTION_PRICE_CENTS,
            product_data: {
              name: SERVICE_NAME,
              description: bookingSummary({ ...booking, ...context })
            }
          }
        }
      ],
      metadata: {
        bookingId,
        serviceName: SERVICE_NAME,
        source: "irongate_booking_form",
        customerType: context.customerType || "homeowner",
        agencyPartnerCode: context.agencyPartnerCode || "",
        agencyName: context.agencyName || ""
      },
      payment_intent_data: {
        metadata: {
          bookingId,
          serviceName: SERVICE_NAME,
          source: "irongate_booking_form",
          customerType: context.customerType || "homeowner",
          agencyPartnerCode: context.agencyPartnerCode || "",
          agencyName: context.agencyName || ""
        }
      }
    });

    await bookingRef.set(
      {
        status: "pending_payment",
        paymentStatus: "checkout_created",
        paymentMethod: "stripe_checkout",
        priceDisplay: INSPECTION_PRICE_DISPLAY,
        stripeCheckoutSessionId: session.id,
        stripeCheckoutUrl: session.url,
        stripeAmountTotal: INSPECTION_PRICE_CENTS,
        stripeCurrency: CURRENCY,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info("Created Stripe Checkout Session", {
      bookingId,
      sessionId: session.id,
      customerType: context.customerType,
      agencyPartnerCode: context.agencyPartnerCode || null
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id
    };
  }
);

exports.createAgencyInvoiceBooking = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public"
  },
  async (request) => {
    const bookingId = String(request.data?.bookingId || "").trim();
    const context = getBookingContext(request.data || {});

    if (!bookingId) {
      throw new HttpsError("invalid-argument", "Missing bookingId.");
    }

    if (context.customerType !== "agent") {
      throw new HttpsError("failed-precondition", "Agency invoice bookings are only available for agency bookings.");
    }

    if (!context.agencyPartnerCode) {
      throw new HttpsError("invalid-argument", "Missing agency partner code.");
    }

    const partner = await findAgencyPartner(context.agencyPartnerCode);
    assertApprovedAgencyPartner(partner);

    const bookingRef = db.collection("bookings").doc(bookingId);
    const bookingSnapshot = await bookingRef.get();

    if (!bookingSnapshot.exists) {
      throw new HttpsError("not-found", "Booking was not found.");
    }

    const booking = bookingSnapshot.data() || {};
    if (booking.paymentStatus === "paid") {
      throw new HttpsError("failed-precondition", "This booking has already been paid.");
    }

    const partnerData = partner.data || {};
    const agencyName = partnerData.agencyName || context.agencyName || "Approved agency partner";

    await bookingRef.set({
      ...removeEmptyValues(context),
      customerType: "agent",
      agencyName,
      agencyPartnerId: partner.id,
      agencyPartnerCode: partner.code,
      agencyInvoiceApproved: true,
      agencyInvoiceTerms: partnerData.invoiceTerms || "7 days",
      paymentMethod: "agency_invoice",
      paymentStatus: "agency_invoice",
      invoiceStatus: "pending",
      status: "agency_invoice_pending",
      priceDisplay: INSPECTION_PRICE_DISPLAY,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    logger.info("Created agency invoice booking", {
      bookingId,
      agencyPartnerCode: partner.code,
      agencyName
    });

    return {
      ok: true,
      bookingId,
      agencyName,
      invoiceTerms: partnerData.invoiceTerms || "7 days"
    };
  }
);

async function markCheckoutSessionPaid(session) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;

  if (!bookingId) {
    logger.warn("Stripe checkout session completed without bookingId", {
      sessionId: session.id
    });
    return;
  }

  const discount = session.total_details?.amount_discount || 0;
  const hasDiscount = discount > 0;

  await db.collection("bookings").doc(bookingId).set(
    {
      status: session.payment_status === "paid" ? "confirmed" : "payment_processing",
      paymentStatus: session.payment_status || "unknown",
      paymentMethod: "stripe_checkout",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null,
      stripeCustomerId:
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id || null,
      stripeAmountSubtotal: session.amount_subtotal || null,
      stripeAmountDiscount: discount,
      stripeAmountTotal: session.amount_total || null,
      stripeCurrency: session.currency || CURRENCY,
      discountApplied: hasDiscount,
      paidAt:
        session.payment_status === "paid"
          ? admin.firestore.FieldValue.serverTimestamp()
          : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  logger.info("Marked booking payment from Stripe webhook", {
    bookingId,
    sessionId: session.id,
    paymentStatus: session.payment_status,
    amountDiscount: discount,
    amountTotal: session.amount_total || null
  });
}

async function markCheckoutSessionExpired(session) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;

  if (!bookingId) {
    return;
  }

  await db.collection("bookings").doc(bookingId).set(
    {
      status: "payment_expired",
      paymentStatus: "expired",
      stripeCheckoutSessionId: session.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );
}

exports.stripeWebhook = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]
  },
  async (req, res) => {
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
      logger.error("Stripe webhook signature verification failed", {
        message: error.message
      });

      res.status(400).send(`Webhook Error: ${error.message}`);
      return;
    }

    try {
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        await markCheckoutSessionPaid(event.data.object);
      }

      if (
        event.type === "checkout.session.expired" ||
        event.type === "checkout.session.async_payment_failed"
      ) {
        await markCheckoutSessionExpired(event.data.object);
      }

      res.status(200).json({ received: true });
    } catch (error) {
      logger.error("Stripe webhook handling failed", {
        eventType: event.type,
        message: error.message
      });

      res.status(500).send("Webhook handler failed");
    }
  }
);
