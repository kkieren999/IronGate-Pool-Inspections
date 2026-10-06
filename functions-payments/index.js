const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Stripe = require("stripe");
const QRCode = require("qrcode");
const { createBookingAndCheckoutSession: createDirectBookingAndCheckoutSession } = require("./direct-booking");

admin.initializeApp();

const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const db = admin.firestore();
const { requireAdmin, executeAdminBookingChange, updateAdminBookingDetails } = require("./admin-booking-service");
const { adminRefundBooking, adminReconcileBookingRefunds, reconcileRefundEvent } = require("./admin-refunds");
const { createBarrierCheckInspection } = require("./barriercheck-direct");

const INSPECTION_PRICE_CENTS = 14900;
const INSPECTION_PRICE_DISPLAY = "$149";
const CURRENCY = "aud";
const SERVICE_NAME = "Pool Safety Inspection & Certificate";
const INVOICE_PROMO_CODE = "INVOICE100";
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
  if (existingSlot.privateInvite === true &&
      Object.prototype.hasOwnProperty.call(existingSlot, "privateInviteOriginal")) {
    return existingSlot.privateInviteOriginal === null ? null : { ...existingSlot.privateInviteOriginal };
  }
  if (existingSlot.bookingCreatedBuffer === true) return null;
  const isUnmarkedBuffer = existingSlot.bufferSlot === true &&
    existingSlot.bookingCreatedBuffer !== false;
  return {
    ...existingSlot,
    available: !isUnmarkedBuffer,
    booked: false,
    locked: false,
    reserved: false,
    reservationStatus: isUnmarkedBuffer ? "legacy_buffer_review" : "released",
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
    const currentBooking = await transaction.get(db.collection("bookings").doc(bookingId));
    if (!currentBooking.exists) return;
    const state = currentBooking.data() || {};
    if (state.status === "cancelled" || state.inspectionStatus === "cancelled" ||
        state.preferredDate !== dateKey || state.preferredTimeSlot !== selectedId ||
        !["paid", "agency_invoice", "no_payment_required"].includes(state.paymentStatus)) return;
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
      slots = current.flatMap((slot) => {
        const id = comparableSlotId(slot);
        if (!slotBelongsToBooking(slot, bookingId)) return [slot];
        if (id !== selectedId && slot.bufferForSlot !== selectedId) return [slot];
        changed = true;
        const restored = releasedSlot(slot, releasedAt);
        return restored ? [restored] : [];
      });
    } else {
      const existingSlots = current && typeof current === "object" ? current : {};
      slots = { ...existingSlots };

      Object.entries(existingSlots).forEach(([id, slot]) => {
        if (!slotBelongsToBooking(slot, bookingId)) return;
        if (id !== selectedId && slot.bufferForSlot !== selectedId) return;
        const restored = releasedSlot(slot, releasedAt);
        if (restored) slots[id] = restored;
        else delete slots[id];
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

function normalisePromotionCode(value) {
  return String(value || "").trim().toUpperCase();
}

async function hydratedCheckoutSession(stripe, session = {}) {
  if (!stripe?.checkout?.sessions?.retrieve || !session?.id) return session || {};
  try {
    return await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["discounts.promotion_code"]
    });
  } catch (expandedError) {
    logger.warn("Could not retrieve expanded Stripe Checkout discount details", {
      sessionId: session.id,
      message: expandedError.message
    });
    try {
      return await stripe.checkout.sessions.retrieve(session.id);
    } catch (plainError) {
      logger.warn("Could not refresh Stripe Checkout Session; using webhook payload", {
        sessionId: session.id,
        message: plainError.message
      });
      return session || {};
    }
  }
}

async function promotionCodeFromSession(stripe, session = {}) {
  const hydrated = await hydratedCheckoutSession(stripe, session);
  const candidates = [hydrated, session].filter(Boolean);

  for (const candidate of candidates) {
    const direct = Array.isArray(candidate.discounts) ? candidate.discounts : [];
    const breakdown = Array.isArray(candidate.total_details?.breakdown?.discounts) ?
      candidate.total_details.breakdown.discounts.map((entry) => entry?.discount || entry) : [];
    const discounts = [...direct, ...breakdown];
    for (const discount of discounts) {
      const promo = discount?.promotion_code || discount?.promotionCode;
      if (promo && typeof promo === "object" && promo.code) {
        return normalisePromotionCode(promo.code);
      }
      if (typeof promo === "string" && stripe?.promotionCodes?.retrieve) {
        try {
          const promotion = await stripe.promotionCodes.retrieve(promo);
          if (promotion?.code) return normalisePromotionCode(promotion.code);
        } catch (error) {
          logger.warn("Could not retrieve Stripe promotion code", {
            promotionCodeId: promo,
            message: error.message
          });
        }
      }
    }
  }

  return null;
}

function checkoutBillingPatch(session = {}, promotionCode = null, currentBooking = {}) {
  const subtotal = Number.isSafeInteger(session.amount_subtotal) ? session.amount_subtotal :
    (Number.isSafeInteger(currentBooking.priceCents) ? currentBooking.priceCents : INSPECTION_PRICE_CENTS);
  const discount = Number.isSafeInteger(session.total_details?.amount_discount) ?
    session.total_details.amount_discount : Number(currentBooking.stripeAmountDiscount || 0);
  const total = Number.isSafeInteger(session.amount_total) ?
    session.amount_total : Number(currentBooking.stripeAmountTotal || 0);
  const completed = isCompletedCheckoutSession(session);
  const noCost = session.payment_status === "no_payment_required" || total === 0;
  const code = normalisePromotionCode(promotionCode || currentBooking.stripePromotionCode);
  const invoicePromo = code === INVOICE_PROMO_CODE;
  const invoiceRequired = completed && invoicePromo && noCost;

  let billingMethod = "stripe";
  let billingStatus = completed && total > 0 ? "paid_stripe" : "payment_processing";
  if (invoiceRequired) {
    billingMethod = "invoice";
    billingStatus = currentBooking.invoiceStatus === "issued" ? "invoice_issued" : "invoice_required";
  } else if (completed && noCost) {
    billingMethod = "no_charge";
    billingStatus = "no_charge";
  }

  return {
    stripePromotionCode: code || null,
    billingMethod,
    billingStatus,
    invoiceRequired,
    invoiceAmountCents: invoiceRequired ? subtotal : null,
    stripeCashReceivedCents: completed ? Math.max(0, total) : 0,
    noCostCheckout: noCost,
    discountApplied: discount > 0
  };
}

async function markCheckoutSessionPaid(session, stripeClient = null) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;
  if (!bookingId) {
    logger.warn("Stripe checkout session completed without bookingId", { sessionId: session.id });
    return;
  }
  const bookingRef = db.collection("bookings").doc(bookingId);
  const discount = session.total_details?.amount_discount || 0;
  const checkoutComplete = isCompletedCheckoutSession(session);
  const paymentStatus = checkoutComplete ? "paid" : session.payment_status || "unknown";
  const promotionCode = await promotionCodeFromSession(stripeClient, session);
  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(bookingRef);
    if (!snapshot.exists) {
      logger.warn("Stripe event booking not found; refusing to create a phantom booking", { bookingId, sessionId: session.id });
      return null;
    }
    const booking = snapshot.data() || {};
    // A delayed unpaid event must never downgrade a payment already confirmed.
    if (booking.paymentStatus === "paid" && !checkoutComplete) return null;
    if (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== session.id) {
      logger.warn("Stripe event belongs to an older checkout session", { bookingId, sessionId: session.id });
      return null;
    }
    const cancelled = booking.status === "cancelled" || booking.inspectionStatus === "cancelled";
    const billing = checkoutBillingPatch(session, promotionCode, booking);
    let slotConflict = false;
    if (checkoutComplete && !cancelled) {
      const date = booking.preferredDate, selectedId = booking.preferredTimeSlot;
      const availability = date && selectedId
        ? await tx.get(db.collection("availability").doc(date)) : null;
      const slots = availability?.exists ? (availability.data() || {}).slots : null;
      const selected = Array.isArray(slots) ?
        slots.find((item) => comparableSlotId(item) === selectedId) : slots?.[selectedId];
      slotConflict = !slotBelongsToBooking(selected, bookingId);
    }
    tx.set(bookingRef, {
      status: cancelled ? "cancelled" : slotConflict ? "payment_exception" :
        (checkoutComplete ? "confirmed" : "payment_processing"),
      paymentStatus,
      stripePaymentStatus: session.payment_status || "unknown",
      paymentMethod: "stripe_checkout",
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ?
        session.payment_intent : session.payment_intent?.id || null,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id || null,
      stripeAmountSubtotal: session.amount_subtotal || null,
      stripeAmountDiscount: discount,
      stripeAmountTotal: session.amount_total ?? null,
      stripeCurrency: session.currency || CURRENCY,
      ...billing,
      availabilityReservationStatus: cancelled ? booking.availabilityReservationStatus || "released" :
        slotConflict ? "conflict" : (checkoutComplete ? "confirmed" : "payment_processing"),
      availabilityLocked: cancelled || slotConflict ? false : booking.availabilityLocked === true,
      availabilityLockStatus: cancelled ? booking.availabilityLockStatus || "cancelled" :
        slotConflict ? "conflict" : (checkoutComplete ? "confirmed" : "payment_processing"),
      availabilityLockError: slotConflict ?
        "Payment completed but the original time is no longer held. Contact customer and allocate manually." :
        cancelled ? booking.availabilityLockError || null : null,
      paidAt: checkoutComplete ? admin.firestore.FieldValue.serverTimestamp() : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { booking, cancelled, slotConflict };
  });
  if (outcome && checkoutComplete && !outcome.cancelled && !outcome.slotConflict) {
    await confirmAvailabilityReservation(bookingId, outcome.booking, paymentStatus);
  }
  logger.info("Stripe booking payment event handled", {
    bookingId, sessionId: session.id, applied: Boolean(outcome), paymentStatus
  });
}

function isInvoicePaymentSession(session = {}) {
  return String(session.metadata?.paymentPurpose || "").toLowerCase() === "invoice_payment";
}

async function markInvoicePaymentPaid(session, stripeClient = null) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;
  const invoiceNumber = String(session.metadata?.invoiceNumber || "").trim();
  if (!bookingId) {
    logger.warn("Invoice Stripe payment completed without bookingId", { sessionId: session.id });
    return;
  }
  if (session.payment_status !== "paid") {
    logger.info("Invoice Checkout Session completed without paid status; awaiting payment success", {
      bookingId, sessionId: session.id, paymentStatus: session.payment_status || "unknown"
    });
    return;
  }

  const bookingRef = db.collection("bookings").doc(bookingId);
  const amountPaid = Number.isSafeInteger(session.amount_total) ? session.amount_total : 0;
  const paymentIntentId = typeof session.payment_intent === "string" ?
    session.payment_intent : session.payment_intent?.id || null;
  const paymentLinkId = typeof session.payment_link === "string" ?
    session.payment_link : session.payment_link?.id || null;

  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(bookingRef);
    if (!snapshot.exists) {
      logger.warn("Invoice payment booking not found", { bookingId, sessionId: session.id });
      return null;
    }
    const booking = snapshot.data() || {};
    if (booking.invoiceRequired !== true ||
        normalisePromotionCode(booking.stripePromotionCode) !== INVOICE_PROMO_CODE) {
      logger.warn("Invoice payment event does not belong to an INVOICE100 booking", {
        bookingId, sessionId: session.id
      });
      return null;
    }
    if (booking.invoiceNumber && invoiceNumber && booking.invoiceNumber !== invoiceNumber) {
      logger.warn("Invoice payment invoice number mismatch", {
        bookingId, sessionId: session.id, expected: booking.invoiceNumber, received: invoiceNumber
      });
      return null;
    }

    const expectedAmount = Number.isSafeInteger(booking.invoiceAmountCents) && booking.invoiceAmountCents > 0 ?
      booking.invoiceAmountCents : INSPECTION_PRICE_CENTS;
    if (amountPaid !== expectedAmount) {
      tx.set(bookingRef, {
        invoicePaymentStatus: "amount_mismatch",
        billingStatus: "invoice_payment_exception",
        invoicePaymentLastSessionId: session.id,
        invoicePaymentLastAmountCents: amountPaid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { applied: false, paymentLinkId };
    }

    if (booking.invoiceStatus === "paid" &&
        booking.stripeInvoicePaymentSessionId === session.id) {
      return { applied: false, alreadyPaid: true, paymentLinkId };
    }

    const stamp = admin.firestore.FieldValue.serverTimestamp();
    tx.set(bookingRef, {
      invoiceStatus: "paid",
      invoicePaymentStatus: "paid",
      billingMethod: "invoice_stripe",
      billingStatus: "invoice_paid_stripe",
      invoicePaidAt: stamp,
      invoicePaidAmountCents: amountPaid,
      stripeCashReceivedCents: amountPaid,
      stripeInvoicePaymentSessionId: session.id,
      stripeInvoicePaymentIntentId: paymentIntentId,
      stripeInvoicePaymentLinkId: paymentLinkId || booking.stripeInvoicePaymentLinkId || null,
      stripeInvoicePaymentCustomerId: typeof session.customer === "string" ?
        session.customer : session.customer?.id || null,
      stripeInvoicePaymentAmountCents: amountPaid,
      stripeInvoicePaymentCurrency: session.currency || CURRENCY,
      stripePaymentIntentId: paymentIntentId || booking.stripePaymentIntentId || null,
      paymentReceivedAt: stamp,
      updatedAt: stamp
    }, { merge: true });

    tx.set(db.collection("adminActivity").doc(bookingId + "_invoice_paid_" + session.id), {
      bookingId,
      action: "invoice_paid_stripe",
      invoiceNumber: booking.invoiceNumber || invoiceNumber || null,
      amountCents: amountPaid,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
      createdAt: stamp
    }, { merge: true });

    return { applied: true, paymentLinkId };
  });

  if (outcome?.paymentLinkId && stripeClient?.paymentLinks?.update) {
    try {
      await stripeClient.paymentLinks.update(outcome.paymentLinkId, { active: false });
    } catch (error) {
      logger.warn("Invoice payment link could not be deactivated after payment", {
        bookingId, paymentLinkId: outcome.paymentLinkId, message: error.message
      });
    }
  }

  logger.info("Stripe invoice payment event handled", {
    bookingId, sessionId: session.id, amountPaid, applied: Boolean(outcome?.applied)
  });
}

async function markCheckoutSessionExpired(session) {
  const bookingId = session.metadata?.bookingId || session.client_reference_id;
  if (!bookingId) return;
  const bookingRef = db.collection("bookings").doc(bookingId);
  const releasedAt = admin.firestore.Timestamp.now();

  // The booking state and held availability MUST be read and changed in the
  // same transaction. An expired event cannot release a slot after payment
  // has already won a concurrent webhook race.
  await db.runTransaction(async (tx) => {
    const bookingSnapshot = await tx.get(bookingRef);
    if (!bookingSnapshot.exists) return;
    const booking = bookingSnapshot.data() || {};
    if (["paid", "no_payment_required", "agency_invoice"].includes(booking.paymentStatus) ||
        ["cancelled", "confirmed", "completed", "certificate_issued"].includes(booking.status) ||
        (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== session.id)) return;

    const date = booking.preferredDate, selectedId = booking.preferredTimeSlot;
    const availabilityRef = date && selectedId ? db.collection("availability").doc(date) : null;
    const availabilitySnap = availabilityRef ? await tx.get(availabilityRef) : null;
    if (availabilitySnap?.exists) {
      const current = (availabilitySnap.data() || {}).slots;
      let changed = false, slots = current;
      if (Array.isArray(current)) {
        slots = current.flatMap((slot) => {
          const id = comparableSlotId(slot);
          if (!slotBelongsToBooking(slot, bookingId) ||
              (id !== selectedId && slot.bufferForSlot !== selectedId)) return [slot];
          changed = true;
          const restored = releasedSlot(slot, releasedAt);
          return restored ? [restored] : [];
        });
      } else if (current && typeof current === "object") {
        slots = { ...current };
        Object.entries(current).forEach(([id, slot]) => {
          if (!slotBelongsToBooking(slot, bookingId) ||
              (id !== selectedId && slot.bufferForSlot !== selectedId)) return;
          changed = true;
          const restored = releasedSlot(slot, releasedAt);
          if (restored) slots[id] = restored;
          else delete slots[id];
        });
      }
      if (changed) tx.set(availabilityRef, {
        slots, updatedAt: releasedAt, updatedBy: "booking_checkout_expired"
      }, { merge: true });
    }
    tx.set(bookingRef, {
      status: "payment_expired", paymentStatus: "expired",
      stripeCheckoutSessionId: session.id,
      availabilityLocked: false,
      availabilityReservationStatus: "released", availabilityLockStatus: "checkout_expired",
      availabilityLockError: null, availabilityReleasedAt: releasedAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
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
        if (isInvoicePaymentSession(event.data.object)) {
          await markInvoicePaymentPaid(event.data.object, stripe);
        } else {
          await markCheckoutSessionPaid(event.data.object, stripe);
        }
      }

      if (
        event.type === "checkout.session.expired" ||
        event.type === "checkout.session.async_payment_failed"
      ) {
        if (!isInvoicePaymentSession(event.data.object)) {
          await markCheckoutSessionExpired(event.data.object);
        }
      }

      if (["refund.created", "refund.updated", "refund.failed"].includes(event.type)) {
        await reconcileRefundEvent(stripe, event.data.object);
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


function validAdminBookingId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,110}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Invalid booking ID.");
  }
  return id;
}

async function adminReconcileBookingBilling(request, stripe) {
  const actor = await requireAdmin(request);
  const bookingId = validAdminBookingId(request.data?.bookingId);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const snapshot = await bookingRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Booking not found.");
  const booking = snapshot.data() || {};
  const sessionId = String(booking.stripeCheckoutSessionId || "").trim();
  if (!/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    throw new HttpsError("failed-precondition", "This booking does not have a Stripe Checkout Session to reconcile.");
  }

  const session = await hydratedCheckoutSession(stripe, { id: sessionId });
  const promotionCode = await promotionCodeFromSession(stripe, session);
  const billing = checkoutBillingPatch(session, promotionCode, booking);
  const patch = {
    ...billing,
    stripePaymentStatus: session.payment_status || booking.stripePaymentStatus || "unknown",
    stripeAmountSubtotal: session.amount_subtotal ?? booking.stripeAmountSubtotal ?? null,
    stripeAmountDiscount: session.total_details?.amount_discount ?? booking.stripeAmountDiscount ?? 0,
    stripeAmountTotal: session.amount_total ?? booking.stripeAmountTotal ?? null,
    stripeCurrency: session.currency || booking.stripeCurrency || CURRENCY,
    billingReconciledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await bookingRef.set(patch, { merge: true });
  logger.info("Admin reconciled booking billing details", {
    bookingId,
    actor: actor.email,
    promotionCode: billing.stripePromotionCode,
    billingStatus: billing.billingStatus
  });
  return {
    bookingId,
    stripePromotionCode: billing.stripePromotionCode,
    billingMethod: billing.billingMethod,
    billingStatus: billing.billingStatus,
    invoiceRequired: billing.invoiceRequired,
    invoiceAmountCents: billing.invoiceAmountCents,
    stripeCashReceivedCents: billing.stripeCashReceivedCents,
    stripeAmountDiscount: patch.stripeAmountDiscount,
    stripeAmountTotal: patch.stripeAmountTotal
  };
}

function brisbaneDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
}

async function adminIssueBookingInvoice(request) {
  const actor = await requireAdmin(request);
  const bookingId = validAdminBookingId(request.data?.bookingId);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const issuedDate = brisbaneDateKey();
  const dueDate = addDaysDateKey(issuedDate, 7);
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(bookingRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = snapshot.data() || {};
    const promo = normalisePromotionCode(booking.stripePromotionCode);
    if (booking.invoiceRequired !== true || promo !== INVOICE_PROMO_CODE) {
      throw new HttpsError("failed-precondition", "This booking is not an INVOICE100 invoice booking.");
    }

    const amountCents = Number.isSafeInteger(booking.invoiceAmountCents) && booking.invoiceAmountCents > 0 ?
      booking.invoiceAmountCents :
      (Number.isSafeInteger(booking.stripeAmountSubtotal) && booking.stripeAmountSubtotal > 0 ?
        booking.stripeAmountSubtotal : INSPECTION_PRICE_CENTS);
    const invoiceNumber = booking.invoiceNumber ||
      `IG-${issuedDate.slice(0, 4)}-${bookingId.slice(-8).toUpperCase()}`;
    const finalIssuedDate = booking.invoiceIssuedDate || issuedDate;
    const finalDueDate = booking.invoiceDueDate || addDaysDateKey(finalIssuedDate, 7);

    if (!booking.invoiceNumber) {
      tx.update(bookingRef, {
        invoiceNumber,
        invoiceStatus: "issued",
        invoiceIssuedDate: finalIssuedDate,
        invoiceDueDate: finalDueDate,
        invoiceIssuedAt: stamp,
        invoiceAmountCents: amountCents,
        billingMethod: "invoice",
        billingStatus: "invoice_issued",
        invoicePaymentMethod: "stripe_only",
        updatedAt: stamp,
        updatedBy: actor.email
      });
      tx.create(db.collection("adminActivity").doc(bookingId + "_invoice_issued"), {
        bookingId,
        action: "invoice_issued",
        actorUid: actor.uid,
        actorEmail: actor.email,
        invoiceNumber,
        amountCents,
        createdAt: stamp
      });
    }

    return {
      bookingId,
      invoiceNumber,
      invoiceStatus: booking.invoiceNumber ? (booking.invoiceStatus || "issued") : "issued",
      invoiceIssuedDate: finalIssuedDate,
      invoiceDueDate: finalDueDate,
      invoiceAmountCents: amountCents,
      billingStatus: booking.invoiceNumber ? (booking.billingStatus || "invoice_issued") : "invoice_issued"
    };
  });
}

async function invoiceQrSvg(url) {
  return QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220
  });
}

async function adminPrepareInvoiceStripePayment(request, stripe) {
  const actor = await requireAdmin(request);
  const bookingId = validAdminBookingId(request.data?.bookingId);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const snapshot = await bookingRef.get();
  if (!snapshot.exists) throw new HttpsError("not-found", "Booking not found.");
  const booking = snapshot.data() || {};
  const promo = normalisePromotionCode(booking.stripePromotionCode);

  if (booking.invoiceRequired !== true || promo !== INVOICE_PROMO_CODE || !booking.invoiceNumber) {
    throw new HttpsError("failed-precondition", "Issue the INVOICE100 invoice before creating its Stripe payment QR.");
  }

  if (booking.invoiceStatus === "paid") {
    return {
      bookingId,
      invoiceNumber: booking.invoiceNumber,
      invoiceStatus: "paid",
      billingStatus: booking.billingStatus || "invoice_paid_stripe",
      invoicePaidAmountCents: booking.invoicePaidAmountCents || booking.invoiceAmountCents || INSPECTION_PRICE_CENTS
    };
  }

  const amountCents = Number.isSafeInteger(booking.invoiceAmountCents) && booking.invoiceAmountCents > 0 ?
    booking.invoiceAmountCents : INSPECTION_PRICE_CENTS;

  let paymentLink = null;
  const existingLinkId = String(booking.stripeInvoicePaymentLinkId || "").trim();
  if (/^plink_[a-zA-Z0-9_]+$/.test(existingLinkId)) {
    try {
      const existing = await stripe.paymentLinks.retrieve(existingLinkId);
      if (existing?.active && existing?.url) paymentLink = existing;
    } catch (error) {
      logger.warn("Could not reuse existing Stripe invoice payment link", {
        bookingId, paymentLinkId: existingLinkId, message: error.message
      });
    }
  }

  if (!paymentLink) {
    paymentLink = await stripe.paymentLinks.create({
      line_items: [{
        quantity: 1,
        price_data: {
          currency: CURRENCY,
          unit_amount: amountCents,
          product_data: {
            name: SERVICE_NAME,
            description: `Invoice ${booking.invoiceNumber} — ${booking.propertyAddress || "Pool safety inspection"}`
          }
        }
      }],
      allow_promotion_codes: false,
      billing_address_collection: "auto",
      customer_creation: "if_required",
      payment_method_types: ["card"],
      restrictions: {
        completed_sessions: { limit: 1 }
      },
      after_completion: {
        type: "hosted_confirmation",
        hosted_confirmation: {
          custom_message: "Thank you. Your invoice payment has been received by Iron Gate Pool Inspections."
        }
      },
      metadata: {
        bookingId,
        invoiceNumber: booking.invoiceNumber,
        paymentPurpose: "invoice_payment",
        originalPromotionCode: INVOICE_PROMO_CODE
      },
      payment_intent_data: {
        description: `${SERVICE_NAME} — ${booking.invoiceNumber}`,
        metadata: {
          bookingId,
          invoiceNumber: booking.invoiceNumber,
          paymentPurpose: "invoice_payment",
          originalPromotionCode: INVOICE_PROMO_CODE
        }
      }
    });

    await bookingRef.set({
      stripeInvoicePaymentLinkId: paymentLink.id,
      stripeInvoicePaymentUrl: paymentLink.url,
      invoicePaymentStatus: "awaiting_payment",
      invoicePaymentMethod: "stripe_only",
      invoicePaymentLinkCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: actor.email
    }, { merge: true });

    await db.collection("adminActivity").doc(bookingId + "_invoice_payment_link").set({
      bookingId,
      action: "invoice_stripe_payment_link_created",
      actorUid: actor.uid,
      actorEmail: actor.email,
      invoiceNumber: booking.invoiceNumber,
      amountCents,
      stripePaymentLinkId: paymentLink.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }

  const qrSvg = await invoiceQrSvg(paymentLink.url);
  return {
    bookingId,
    invoiceNumber: booking.invoiceNumber,
    invoiceStatus: booking.invoiceStatus || "issued",
    billingStatus: booking.billingStatus || "invoice_issued",
    invoiceAmountCents: amountCents,
    stripeInvoicePaymentLinkId: paymentLink.id,
    stripeInvoicePaymentUrl: paymentLink.url,
    invoicePaymentStatus: booking.invoicePaymentStatus || "awaiting_payment",
    invoicePaymentQrSvg: qrSvg
  };
}

exports.adminReconcileBookingBilling = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB",
  invoker: "public", secrets: [STRIPE_SECRET_KEY]
}, async (request) => adminReconcileBookingBilling(request, getStripe()));

exports.adminIssueBookingInvoice = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB", invoker: "public"
}, async (request) => adminIssueBookingInvoice(request));

exports.adminPrepareInvoiceStripePayment = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB",
  invoker: "public", secrets: [STRIPE_SECRET_KEY]
}, async (request) => adminPrepareInvoiceStripePayment(request, getStripe()));

exports.adminMoveBooking = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB", invoker: "public"
}, async (request) => executeAdminBookingChange(request, "move"));

exports.adminCancelBooking = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB", invoker: "public"
}, async (request) => executeAdminBookingChange(request, "cancel"));

exports.adminUpdateBookingDetails = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB", invoker: "public"
}, async (request) => updateAdminBookingDetails(request));

exports.adminCreateBarrierCheckInspection = onCall({
  region: "us-central1", timeoutSeconds: 30, memory: "256MiB", invoker: "public"
}, async (request) => createBarrierCheckInspection(request, db));


exports.adminRefundBooking = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "256MiB",
  invoker: "public", secrets: [STRIPE_SECRET_KEY]
}, async (request) => adminRefundBooking(request, getStripe()));


exports.adminReconcileBookingRefunds = onCall({
  region: "us-central1", timeoutSeconds: 60, memory: "256MiB",
  invoker: "public", secrets: [STRIPE_SECRET_KEY]
}, async (request) => adminReconcileBookingRefunds(request, getStripe()));
