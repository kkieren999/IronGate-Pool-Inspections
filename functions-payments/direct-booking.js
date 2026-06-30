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
      const error = new Error(`Missing required booking field: ${key}`);
      error.code = "invalid-argument";
      throw error;
    }
  }

  if (!asBoolean(booking.termsAccepted) || !asBoolean(booking.privacyAccepted)) {
    const error = new Error("Terms and privacy policy must be accepted.");
    error.code = "invalid-argument";
    throw error;
  }

  if (!/^\S+@\S+\.\S+$/.test(asString(booking.email))) {
    const error = new Error("Invalid customer email address.");
    error.code = "invalid-argument";
    throw error;
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
    const error = new Error("Missing or invalid success/cancel URL.");
    error.code = "invalid-argument";
    throw error;
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

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: bookingId,
    customer_email: booking.email || undefined,
    success_url: addCheckoutParams(successUrl, bookingId),
    cancel_url: cancelUrl.toString(),
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

  await bookingRef.set({
    ...booking,
    stripeCheckoutSessionId: session.id,
    stripeCheckoutUrl: session.url,
    stripeAmountTotal: priceCents,
    stripeCurrency: currency
  });

  return {
    bookingId,
    checkoutUrl: session.url,
    sessionId: session.id
  };
}

module.exports = {
  createBookingAndCheckoutSession
};
