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
  "bookingRoleCode",
  "agencyName",
  "bookingRelationship",
  "poolOwnerStatus",
  "poolOwnerName",
  "poolOwnerEmail",
  "ownerDetailsPending",
  "accessSameAsBooking",
  "accessContactName",
  "accessContactPhone",
  "accessContactEmail",
  "accessContactAgency",
  "accessMethod",
  "keyCollectionLocation",
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
const BOOKING_ROLES = Object.freeze({
  owner: "Property owner",
  agent: "Real estate agent / property manager",
  agency: "Agency / organisation representative",
  other: "Other authorised person"
});

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

function todayBusinessDateKey() {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function minutesFromTime(time = "") {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addOneHour(time = "") {
  return timeFromMinutes(minutesFromTime(time) + 60);
}

function slotIdFromTime(time = "") {
  return String(time || "").replace(":", "_");
}

function nextSlotId(slot = {}, booking = {}) {
  const nextStart = slot.end || booking.preferredTimeEnd || addOneHour(slot.start || booking.preferredTimeStart);
  return nextStart ? slotIdFromTime(nextStart) : "";
}

function assertBookableDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) {
    throw codedError("invalid-argument", "Invalid inspection date.");
  }

  if (String(dateKey) <= todayBusinessDateKey()) {
    throw codedError("failed-precondition", "Please choose an inspection date from tomorrow onwards.");
  }
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

  const role = asString(booking.bookingRoleCode);
  if (!Object.hasOwn(BOOKING_ROLES, role)) {
    throw codedError("invalid-argument", "Choose a valid booking contact role.");
  }
  const isOwner = role === "owner";
  if (booking.isPropertyOwner !== isOwner ||
      (isOwner ? booking.poolOwnerStatus !== "self" : !asBoolean(booking.authorisedToBook))) {
    throw codedError("invalid-argument", "Please confirm the pool owner or your authority to book.");
  }
  if (["agent", "agency"].includes(role) && !asString(booking.agencyName)) {
    throw codedError("invalid-argument", "Company or agency name is required.");
  }
  if (role === "other" && !asString(booking.bookingRelationship)) {
    throw codedError("invalid-argument", "Please describe your relationship to the property.");
  }
  const ownerStatus = asString(booking.poolOwnerStatus);
  if (!["self", "different", "pending"].includes(ownerStatus) ||
      (isOwner && ownerStatus !== "self") || (!isOwner && ownerStatus === "self")) {
    throw codedError("invalid-argument", "Choose a valid pool owner status.");
  }
  if (ownerStatus === "different" && !asString(booking.poolOwnerName)) {
    throw codedError("invalid-argument", "Pool owner's name is required when their details are known.");
  }
  if (ownerStatus === "pending" && booking.ownerDetailsPending !== true) {
    throw codedError("invalid-argument", "Outstanding owner details must be recorded.");
  }
  if (booking.poolOwnerEmail && !/^\S+@\S+\.\S+$/.test(asString(booking.poolOwnerEmail))) {
    throw codedError("invalid-argument", "Invalid pool owner email.");
  }
  if (booking.accessSameAsBooking !== true &&
      (!asString(booking.accessContactName) || !/^[+0-9()\s-]{6,22}$/.test(asString(booking.accessContactPhone)))) {
    throw codedError("invalid-argument", "Enter a valid separate access contact and phone number.");
  }
  if (booking.accessContactEmail && !/^\S+@\S+\.\S+$/.test(asString(booking.accessContactEmail))) {
    throw codedError("invalid-argument", "Invalid access contact email.");
  }
  if (!["on_site", "keys", "lockbox", "other"].includes(booking.accessMethod) ||
      (booking.accessMethod === "keys" && !asString(booking.keyCollectionLocation)) ||
      (booking.accessMethod !== "on_site" && booking.accessPermissionIfNotHome !== true)) {
    throw codedError("invalid-argument", "Please confirm valid property access arrangements.");
  }
  if (booking.animalsOnProperty === true && booking.animalsWillBeSecured !== true) {
    throw codedError("invalid-argument", "Animals must be secured before inspection.");
  }
  const limits = {
    customerName: 140, email: 180, agencyName: 140, bookingRelationship: 140,
    poolOwnerName: 180, poolOwnerEmail: 180, accessContactName: 140,
    accessContactPhone: 22, accessContactEmail: 180, accessContactAgency: 140,
    keyCollectionLocation: 400, accessInstructions: 1500, notes: 1500
  };
  for (const [key, max] of Object.entries(limits)) {
    if (asString(booking[key]).length > max) {
      throw codedError("invalid-argument", "The " + key + " field is too long.");
    }
  }
  assertBookableDate(booking.preferredDate);
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
  booking.bookingRoleCode = asString(booking.bookingRoleCode);
  booking.clientType = BOOKING_ROLES[booking.bookingRoleCode] || "";
  booking.bookingRole = booking.clientType;
  for (const key of [
    "agencyName", "bookingRelationship", "poolOwnerName", "poolOwnerEmail",
    "accessContactName", "accessContactPhone", "accessContactEmail",
    "accessContactAgency", "keyCollectionLocation"
  ]) booking[key] = asString(booking[key]);
  booking.poolOwnerEmail = booking.poolOwnerEmail.toLowerCase();
  booking.accessContactEmail = booking.accessContactEmail.toLowerCase();
  booking.poolOwnerStatus = asString(booking.poolOwnerStatus);
  booking.accessMethod = asString(booking.accessMethod);
  booking.ownerDetailsPending = booking.poolOwnerStatus === "pending";
  booking.accessSameAsBooking = asBoolean(booking.accessSameAsBooking);
  if (booking.bookingRoleCode === "owner") {
    booking.poolOwnerName = booking.customerName;
    booking.poolOwnerEmail = booking.email;
  }
  if (booking.accessSameAsBooking) {
    booking.accessContactName = booking.customerName;
    booking.accessContactPhone = booking.phone;
    booking.accessContactEmail = booking.email;
    booking.accessContactAgency = booking.agencyName;
  }
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
    customerType: booking.bookingRoleCode === "owner" ? "homeowner" : booking.bookingRoleCode,
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

function buildBufferSlot(existingSlot = {}, bufferId, selectedId, bookingId, booking = {}, reservedAt, synthetic = false) {
  const start = existingSlot.start || booking.preferredTimeEnd || String(bufferId).replace("_", ":");
  const end = existingSlot.end || addOneHour(start);

  return {
    ...existingSlot,
    id: existingSlot.id || bufferId,
    start,
    end,
    label: existingSlot.label || `${start} - ${end}`,
    available: false,
    booked: true,
    locked: true,
    reserved: true,
    reservationStatus: "pending_checkout_buffer",
    bufferSlot: true,
    bufferForSlot: selectedId,
    // Preserve whether this buffer was invented solely for this checkout.
    bookingCreatedBuffer: synthetic || existingSlot.bookingCreatedBuffer === true,
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
    let selectedSlot = null;
    const updated = currentSlots.map((slot) => {
      if (comparableSlotId(slot) !== selectedId) return slot;
      found = true;
      assertSlotCanBeReserved(slot);
      selectedSlot = slot;
      return buildReservedSlot(slot, selectedId, bookingId, booking, reservedAt);
    });

    if (!found) {
      throw codedError("failed-precondition", "Selected time slot is no longer available.");
    }

    const bufferId = nextSlotId(selectedSlot, booking);
    if (bufferId) {
      let bufferFound = false;
      const withBuffer = updated.map((slot) => {
        if (comparableSlotId(slot) !== bufferId) return slot;
        bufferFound = true;
        assertSlotCanBeReserved(slot);
        return buildBufferSlot(slot, bufferId, selectedId, bookingId, booking, reservedAt);
      });

      if (!bufferFound) {
        withBuffer.push(buildBufferSlot({}, bufferId, selectedId, bookingId, booking, reservedAt, true));
      }

      return withBuffer;
    }

    return updated;
  }

  const slots = currentSlots && typeof currentSlots === "object" ? currentSlots : {};
  const existing = slots[selectedId];
  assertSlotCanBeReserved(existing);
  const bufferId = nextSlotId(existing, booking);
  const bufferSlot = bufferId ? slots[bufferId] : null;

  if (bufferSlot) {
    assertSlotCanBeReserved(bufferSlot);
  }

  return {
    ...slots,
    [selectedId]: buildReservedSlot(existing, selectedId, bookingId, booking, reservedAt),
    ...(bufferId ? {
      [bufferId]: buildBufferSlot(bufferSlot || {}, bufferId, selectedId, bookingId, booking, reservedAt, !bufferSlot)
    } : {})
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
      customerType: booking.customerType
    },
    payment_intent_data: {
      metadata: {
        bookingId,
        serviceName,
        source: "irongate_booking_form_backend",
        customerType: booking.customerType
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
