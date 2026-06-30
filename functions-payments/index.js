const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Stripe = require("stripe");
const { createBookingAndCheckoutSession: createDirectBookingAndCheckoutSession } = require("./direct-booking");

admin.initializeApp();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const db = admin.firestore();

const INSPECTION_PRICE_CENTS = 24900;
const INSPECTION_PRICE_DISPLAY = "$249";
const CURRENCY = "aud";
const SERVICE_NAME = "Pool Safety Inspection & Certificate";
const PUBLIC_ERROR_CODES = new Set(["invalid-argument", "failed-precondition", "not-found"]);

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

function isCompletedCheckoutSession(session = {}) {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

function throwPublicHttpsError(error, fallbackMessage) {
  if (PUBLIC_ERROR_CODES.has(error.code)) {
    throw new HttpsError(error.code, error.message || fallbackMessage);
  }

  throw new HttpsError("internal", fallbackMessage);
}

function comparableSlotId(item = {}) {
  if (item.id) return String(item.id);
  if (item.start) return String(item.start).replace(":", "_");
  return "";
}

function slotBelongsToBooking(slot = {}, bookingId) {
  const existingBookingId = slot.bookedByBookingId || slot.bookingId || "";
  return existingBookingId === bookingId;
}

function addOneHour(time = "") {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  const start = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  start.setUTCHours(start.getUTCHours() + 1);
  return `${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")}`;
}

function bookingSlotBase(selectedId, booking = {}) {
  const start = booking.preferredTimeStart || String(selectedId).replace("_", ":");
  const end = booking.preferredTimeEnd || addOneHour(start);

  return {
    id: selectedId,
    start,
    end,
    label: booking.preferredTimeLabel || booking.preferredTime || (start && end ? `${start} – ${end}` : selectedId),
    bookingId: booking.id || "",
    bookedByBookingId: booking.id || "",
    customerName: booking.customerName || "",
    propertyAddress: booking.propertyAddress || ""
  };
}

function confirmedSlot(existingSlot = {}, selectedId, bookingId, booking = {}, confirmedAt, paymentStatus) {
  return {
    ...bookingSlotBase(selectedId, { ...booking, id: bookingId }),
    ...existingSlot,
    id: existingSlot.id || selectedId,
    available: false,
    booked: true,
    locked: true,
    reserved: false,
    reservationStatus: "confirmed",
    bookingId,
    bookedByBookingId: bookingId,
    customerName: booking.customerName || existingSlot.customerName || "",
    propertyAddress: booking.propertyAddress || existingSlot.propertyAddress || "",
    paymentStatus,
    confirmedAt
  };
}

function releasedSlot(existingSlot = {}, releasedAt) {
  return {
    ...existingSlot,
    available: true,
    booked: false,
    locked: false,
    reserved: false,
    reservationStatus: "released",
    bookingId: null,
    bookedByBookingId: null,
    customerName: "",
    propertyAddress: "",
    paymentStatus: "expired",
    releasedAt
  };
}

async function confirmAvailabilityReservation(bookingId, booking = {}, paymentStatus = "paid") {
  const dateKey = booking.preferredDate;
  const selectedId = booking.preferredTimeSlot;

  if (!dateKey || !selectedId) return;

  const availabilityRef = db.collection("availability").doc(dateKey);
  const confirmedAt = admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(availabilityRef);
    if (!snapshot.exists) return;

    const data = snapshot.data() || {};
    const current = data.slots;
    let slots = current;
    let changed = false;

    if (Array.isArray(current)) {
      let selectedChanged = false;
      slots = current.map((slot) => {
        const id = comparableSlotId(slot);
        const isSelectedSlot = id === selectedId;
        const isLinkedBuffer = slotBelongsToBooking(slot, bookingId) && slot.bufferForSlot === selectedId;
        if (!isSelectedSlot && !isLinkedBuffer) return slot;
        if (isSelectedSlot && !slotBelongsToBooking(slot, bookingId)) return slot;
        changed = true;
        if (isSelectedSlot) selectedChanged = true;
        return confirmedSlot(slot, id || selectedId, bookingId, booking, confirmedAt, paymentStatus);
      });

      if (!selectedChanged) {
        slots = [
          ...slots,
          confirmedSlot({}, selectedId, bookingId, booking, confirmedAt, paymentStatus)
        ];
        changed = true;
      }
    } else {
      const existingSlots = current && typeof current === "object" ? current : {};
      const existing = existingSlots[selectedId] || {};
      slots = { ...existingSlots };

      if (!existingSlots[selectedId] || slotBelongsToBooking(existing, bookingId)) {
        slots = {
          ...slots,
          [selectedId]: confirmedSlot(existing, selectedId, bookingId, booking, confirmedAt, paymentStatus)
        };
        changed = true;
      }

      Object.entries(existingSlots).forEach(([id, slot]) => {
        if (id === selectedId || !slotBelongsToBooking(slot, bookingId) || slot.bufferForSlot !== selectedId) return;
        slots[id] = confirmedSlot(slot, id, bookingId, booking, confirmedAt, paymentStatus);
        changed = true;
      });
    }

    if (changed) {
      transaction.set(availabilityRef, {
        slots,
        updatedAt: confirmedAt,
        updatedBy: "booking_checkout_confirmed"
      }, { merge: true });
    }
  });
}

async function releaseAvailabilityReservation(bookingId, booking = {}) {
  const dateKey = booking.preferredDate;
  const selectedId = booking.preferredTimeSlot;

  if (!dateKey || !selectedId) return;

  const availabilityRef = db.collection("availability").doc(dateKey);
  const releasedAt = admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(availabilityRef);
    if (!snapshot.exists) return;

    const data = snapshot.data() || {};
    const current = data.slots;
    let slots = current;
    let changed = false;

    if (Array.isArray(current)) {
      slots = current.map((slot) => {
        const id = comparableSlotId(slot);
        if (!slotBelongsToBooking(slot, bookingId)) return slot;
        if (id !== selectedId && slot.bufferForSlot !== selectedId) return slot;
        changed = true;
        return releasedSlot(slot, releasedAt);
      });
    } else {
      const existingSlots = current && typeof current === "object" ? current : {};
      slots = { ...existingSlots };

      Object.entries(existingSlots).forEach(([id, slot]) => {
        if (!slotBelongsToBooking(slot, bookingId)) return;
        if (id !== selectedId && slot.bufferForSlot !== selectedId) return;
        slots[id] = releasedSlot(slot, releasedAt);
        changed = true;
      });
    }

    if (changed) {
      transaction.set(availabilityRef, {
        slots,
        updatedAt: releasedAt,
        updatedBy: "booking_checkout_released"
      }, { merge: true });
    }
  });
}

async function createBackendBookingCheckout(request) {
  const result = await createDirectBookingAndCheckoutSession({
    request,
    db,
    stripe: getStripe(),
    normaliseUrl,
    addCheckoutParams,
    bookingSummary,
    serviceName: SERVICE_NAME,
    priceCents: INSPECTION_PRICE_CENTS,
    priceDisplay: INSPECTION_PRICE_DISPLAY,
    currency: CURRENCY
  });

  logger.info("Created backend booking and reserved Stripe Checkout Session slot", {
    bookingId: result.bookingId,
    sessionId: result.sessionId,
    source: "backend_booking_checkout"
  });

  return result;
}

exports.createBookingAndCheckoutSession = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
    secrets: [STRIPE_SECRET_KEY]
  },
  async (request) => {
    try {
      return await createBackendBookingCheckout(request);
    } catch (error) {
      logger.error("Could not create backend booking checkout session", {
        message: error.message,
        code: error.code || null
      });

      throwPublicHttpsError(error, "Could not create booking checkout session.");
    }
  }
);

exports.createBookingCheckoutSession = onCall(
  {
    region: "us-central1",
    timeoutSeconds: 30,
    memory: "256MiB",
    invoker: "public",
    secrets: [STRIPE_SECRET_KEY]
  },
  async (request) => {
    if (request.data?.booking) {
      try {
        return await createBackendBookingCheckout(request);
      } catch (error) {
        logger.error("Could not create backend booking checkout session through existing callable", {
          message: error.message,
          code: error.code || null
        });

        throwPublicHttpsError(error, "Could not create booking checkout session.");
      }
    }

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
      cancel_url: addCheckoutParams(cancelUrl, bookingId),
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
              description: bookingSummary(booking)
            }
          }
        }
      ],
      metadata: {
        bookingId,
        serviceName: SERVICE_NAME,
        source: "irongate_booking_form",
        customerType: "homeowner"
      },
      payment_intent_data: {
        metadata: {
          bookingId,
          serviceName: SERVICE_NAME,
          source: "irongate_booking_form",
          customerType: "homeowner"
        }
      }
    });

    await bookingRef.set(
      {
        customerType: "homeowner",
        bookingRole: "Homeowner",
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
      customerType: "homeowner"
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
  async () => {
    throw new HttpsError("failed-precondition", "Agency invoice bookings are not currently available through the website.");
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

  const bookingRef = db.collection("bookings").doc(bookingId);
  const bookingSnapshot = await bookingRef.get();
  const booking = bookingSnapshot.exists ? bookingSnapshot.data() || {} : {};
  const discount = session.total_details?.amount_discount || 0;
  const hasDiscount = discount > 0;
  const checkoutComplete = isCompletedCheckoutSession(session);
  const paymentStatus = checkoutComplete ? "paid" : session.payment_status || "unknown";

  await bookingRef.set(
    {
      status: checkoutComplete ? "confirmed" : "payment_processing",
      paymentStatus,
      stripePaymentStatus: session.payment_status || "unknown",
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
      noCostCheckout: session.payment_status === "no_payment_required" || session.amount_total === 0,
      availabilityReservationStatus: checkoutComplete ? "confirmed" : "payment_processing",
      availabilityLockStatus: checkoutComplete ? "confirmed" : "payment_processing",
      availabilityLockError: null,
      paidAt: checkoutComplete ? admin.firestore.FieldValue.serverTimestamp() : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  if (checkoutComplete) {
    await confirmAvailabilityReservation(bookingId, booking, paymentStatus);
  }

  logger.info("Marked booking payment from Stripe webhook", {
    bookingId,
    sessionId: session.id,
    paymentStatus,
    stripePaymentStatus: session.payment_status,
    amountDiscount: discount,
    amountTotal: session.amount_total || null
  });
}

async function markCheckoutSessionExpired(session) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;

  if (!bookingId) {
    return;
  }

  const bookingRef = db.collection("bookings").doc(bookingId);
  const bookingSnapshot = await bookingRef.get();
  const booking = bookingSnapshot.exists ? bookingSnapshot.data() || {} : {};

  await releaseAvailabilityReservation(bookingId, booking);

  await bookingRef.set(
    {
      status: "payment_expired",
      paymentStatus: "expired",
      stripeCheckoutSessionId: session.id,
      availabilityLocked: false,
      availabilityReservationStatus: "released",
      availabilityLockStatus: "checkout_expired",
      availabilityLockError: null,
      availabilityReleasedAt: admin.firestore.FieldValue.serverTimestamp(),
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
