const admin = require("firebase-admin");

const BOOKING_ALLOWED_FIELDS = [
  "customerName",
  "email",
  "phone",
  "propertyAddress",
  "propertyAddressSelected",
  "propertyPlaceId",
  "isPropertyOwner",
  "authorisedToBook",
  "clientType",
  "inspectionReason",
  "poolType",
  "existingCertificateStatus",
  "poolRegisteredStatus",
  "preferredDate",
  "preferredDateDisplay",
  "preferredTimeSlot",
  "preferredTimeLabel",
  "preferredTimeStart",
  "preferredTimeEnd",
  "preferredTime",
  "willBeHomeForInspection",
  "accessPermissionIfNotHome",
  "animalsOnProperty",
  "animalsOffLeash",
  "animalsWillBeSecured",
  "accessInstructions",
  "hasPoolExemption",
  "minorRepairsContactAccepted",
  "nonComplianceAcknowledged",
  "informationAccuracyConfirmed",
  "notes",
  "termsAccepted",
  "privacyAccepted"
];

const CHECKOUT_HOLD_MINUTES = 30;

function asString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function asBoolean(value) {
  return value === true;
}

function cleanPhone(value) {
  return asString(value).replace(/[\s()-]/g, "");
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function comparableSlotId(item = {}) {
  if (item.id) return String(item.id);
  if (item.start) return String(item.start).replace(":", "_");
  return "";
}

function assertValidBooking(booking) {
  const required = [
    "customerName",
    "email",
    "phone",
    "propertyAddress",
    "preferredDate",
    "preferredTimeSlot",
    "preferredTimeStart",
    "preferredTimeEnd"
  ];

  for (const key of required) {
    if (!asString(booking[key])) {
      throw codedError("invalid-argument", `Missing required booking field: ${key}`);
    }
  }

  if (booking.propertyAddressSelected !== true) {
    throw codedError("invalid-argument", "Please select the property address from the suggestions.");
  }

  if (!asBoolean(booking.termsAccepted) || !asBoolean(booking.privacyAccepted)) {
    throw codedError("invalid-argument", "Terms and privacy policy must be accepted.");
  }

  if (!/^\S+@\S+\.\S+$/.test(asString(booking.email))) {
    throw codedError("invalid-argument", "Invalid customer email address.");
  }
}

function publicBookingData(rawBooking = {}, config = {}) {
  const booking = {};

  for (const key of BOOKING_ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(rawBooking, key)) {
      booking[key] = rawBooking[key];
    }
  }

  booking.customerName = asString(booking.customerName);
  booking.email = asString(booking.email).toLowerCase();
  booking.phone = cleanPhone(booking.phone);
  booking.propertyAddress = asString(booking.propertyAddress);
  booking.propertyAddressSelected = asBoolean(booking.propertyAddressSelected);
  booking.propertyPlaceId = asString(booking.propertyPlaceId);
  booking.clientType = asString(booking.clientType, booking.isPropertyOwner ? "Property owner" : "Authorised representative");
  booking.preferredDate = asString(booking.preferredDate);
  booking.preferredDateDisplay = asString(booking.preferredDateDisplay, booking.preferredDate);
  booking.preferredTimeSlot = asString(booking.preferredTimeSlot);
  booking.preferredTimeLabel = asString(booking.preferredTimeLabel, booking.preferredTimeSlot);
  booking.preferredTimeStart = asString(booking.preferredTimeStart);
  booking.preferredTimeEnd = asString(booking.preferredTimeEnd);
  booking.preferredTime = asString(booking.preferredTime, booking.preferredTimeLabel);
  booking.accessInstructions = asString(booking.accessInstructions);
  booking.notes = asString(booking.notes);

  booking.isPropertyOwner = asBoolean(booking.isPropertyOwner);
  booking.authorisedToBook = asBoolean(booking.authorisedToBook);
  booking.willBeHomeForInspection = asBoolean(booking.willBeHomeForInspection);
  booking.accessPermissionIfNotHome = asBoolean(booking.accessPermissionIfNotHome);
  booking.animalsOnProperty = asBoolean(booking.animalsOnProperty);
  booking.animalsOffLeash = asBoolean(booking.animalsOffLeash);
  booking.animalsWillBeSecured = asBoolean(booking.animalsWillBeSecured);
  booking.hasPoolExemption = asBoolean(booking.hasPoolExemption);
  booking.minorRepairsContactAccepted = asBoolean(booking.minorRepairsContactAccepted);
  booking.nonComplianceAcknowledged = asBoolean(booking.nonComplianceAcknowledged);
  booking.informationAccuracyConfirmed = asBoolean(booking.informationAccuracyConfirmed);
  booking.termsAccepted = asBoolean(booking.termsAccepted);
  booking.privacyAccepted = asBoolean(booking.privacyAccepted);

  return {
    ...booking,
    exemptionFileUploaded: false,
    exemptionFile: null,
    serviceName: config.serviceName,
    priceCents: config.priceCents,
    priceDisplay: config.priceDisplay,
    currency: config.currency,
    customerType: "homeowner",
    bookingRole: "Homeowner",
    status: "pending_payment",
    paymentStatus: "checkout_created",
    paymentMethod: "stripe_checkout",
    source: "website_booking_form_backend",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    paidAt: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function assertSlotCanBeReserved(slot = {}) {
  if (!slot || typeof slot !== "object") {
    throw codedError("failed-precondition", "Selected time slot is no longer available.");
  }

  if (slot.available === false || slot.booked === true || slot.locked === true || slot.reserved === true) {
    throw codedError("failed-precondition", "Selected time slot has already been booked. Please choose another time.");
  }
}

function buildReservedSlot(existingSlot = {}, selectedId, bookingId, booking = {}, reservedAt) {
  return {
    ...existingSlot,
    id: existingSlot.id || selectedId,
    start: existingSlot.start || booking.preferredTimeStart,
    end: existingSlot.end || booking.preferredTimeEnd,
    label: existingSlot.label || booking.preferredTimeLabel || booking.preferredTime,
    available: false,
    booked: true,
    locked: true,
    reserved: true,
    reservationStatus: "pending_checkout",
    bookingId,
    bookedByBookingId: bookingId,
    customerName: booking.customerName || "",
    propertyAddress: booking.propertyAddress || "",
    paymentStatus: "checkout_created",
    reservedAt
  };
}

function reserveSelectedSlot(currentSlots, selectedId, bookingId, booking, reservedAt) {
  if (Array.isArray(currentSlots)) {
    let found = false;
    const updated = currentSlots.map((slot) => {
      if (comparableSlotId(slot) !== selectedId) return slot;
      found = true;
      assertSlotCanBeReserved(slot);
      return buildReservedSlot(slot, selectedId, bookingId, booking, reservedAt);
    });

    if (!found) {
      throw codedError("failed-precondition", "Selected time slot is no longer available.");
    }

    return updated;
  }

  const slots = currentSlots && typeof currentSlots === "object" ? currentSlots : {};
  const existing = slots[selectedId];
  assertSlotCanBeReserved(existing);

  return {
    ...slots,
    [selectedId]: buildReservedSlot(existing, selectedId, bookingId, booking, reservedAt)
  };
}

async function expireCheckoutSession(stripe, sessionId) {
  if (!sessionId) return;

  try {
    await stripe.checkout.sessions.expire(sessionId);
  } catch (error) {
    // The session may already be complete or expired. The Firestore transaction failure is the important error.
  }
}

async function createBookingAndCheckoutSession({
  request,
  db,
  stripe,
  normaliseUrl,
  addCheckoutParams,
  bookingSummary,
  serviceName,
  priceCents,
  priceDisplay,
  currency
}) {
  const successUrl = normaliseUrl(request.data?.successUrl);
  const cancelUrl = normaliseUrl(request.data?.cancelUrl);
  const bookingInput = request.data?.booking || {};

  if (!successUrl || !cancelUrl) {
    throw codedError("invalid-argument", "Missing or invalid success/cancel URL.");
  }

  assertValidBooking(bookingInput);

  const bookingRef = db.collection("bookings").doc();
  const bookingId = bookingRef.id;
  const booking = publicBookingData(bookingInput, {
    serviceName,
    priceCents,
    priceDisplay,
    currency
  });
  const checkoutExpiresAtSeconds = Math.floor(Date.now() / 1000) + CHECKOUT_HOLD_MINUTES * 60;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: bookingId,
    customer_email: booking.email || undefined,
    success_url: addCheckoutParams(successUrl, bookingId),
    cancel_url: addCheckoutParams(cancelUrl, bookingId),
    expires_at: checkoutExpiresAtSeconds,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: priceCents,
          product_data: {
            name: serviceName,
            description: bookingSummary(booking)
          }
        }
      }
    ],
    metadata: {
      bookingId,
      serviceName,
      source: "irongate_booking_form_backend",
      customerType: "homeowner"
    },
    payment_intent_data: {
      metadata: {
        bookingId,
        serviceName,
        source: "irongate_booking_form_backend",
        customerType: "homeowner"
      }
    }
  });

  try {
    await db.runTransaction(async (transaction) => {
      const availabilityRef = db.collection("availability").doc(booking.preferredDate);
      const availabilitySnapshot = await transaction.get(availabilityRef);

      if (!availabilitySnapshot.exists) {
        throw codedError("failed-precondition", "Selected date is no longer available.");
      }

      const availability = availabilitySnapshot.data() || {};
      const reservedAt = admin.firestore.Timestamp.now();
      const checkoutExpiresAt = admin.firestore.Timestamp.fromMillis(checkoutExpiresAtSeconds * 1000);
      const slots = reserveSelectedSlot(
        availability.slots,
        booking.preferredTimeSlot,
        bookingId,
        booking,
        reservedAt
      );

      transaction.set(availabilityRef, {
        slots,
        updatedAt: reservedAt,
        updatedBy: "booking_checkout_reservation"
      }, { merge: true });

      transaction.set(bookingRef, {
        ...booking,
        stripeCheckoutSessionId: session.id,
        stripeCheckoutUrl: session.url,
        stripeAmountTotal: priceCents,
        stripeCurrency: currency,
        checkoutExpiresAt,
        availabilityLocked: true,
        availabilityLockStatus: "checkout_reserved",
        availabilityLockError: null,
        availabilityLockedAt: reservedAt,
        availabilityLockDate: booking.preferredDate,
        availabilityLockSlot: booking.preferredTimeSlot,
        availabilityReservationStatus: "pending_checkout"
      });
    });
  } catch (error) {
    await expireCheckoutSession(stripe, session.id);
    throw error;
  }

  return {
    bookingId,
    checkoutUrl: session.url,
    sessionId: session.id
  };
}

module.exports = {
  createBookingAndCheckoutSession
};
