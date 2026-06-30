const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");

admin.initializeApp();

const GOOGLE_CALENDAR_ID = defineSecret("GOOGLE_CALENDAR_ID");
const TIME_ZONE = "Australia/Brisbane";
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "agency_invoice"]);
const CALENDAR_RELEVANT_FIELDS = [
  "preferredDate",
  "preferredTimeStart",
  "preferredTimeEnd",
  "preferredTimeLabel",
  "preferredTime",
  "customerName",
  "phone",
  "email",
  "propertyAddress",
  "inspectionReason",
  "poolType",
  "accessInstructions",
  "notes",
  "status",
  "inspectionStatus",
  "paymentStatus"
];

function field(data, key, fallback = "") {
  const value = data?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function hasJustBecomeConfirmed(before = {}, after = {}) {
  return !CONFIRMED_PAYMENT_STATUSES.has(before.paymentStatus) && CONFIRMED_PAYMENT_STATUSES.has(after.paymentStatus);
}

function isConfirmedBooking(data = {}) {
  return data.status === "confirmed"
    || data.status === "completed"
    || data.status === "certificate_issued"
    || CONFIRMED_PAYMENT_STATUSES.has(data.paymentStatus);
}

function isCancelledBooking(data = {}) {
  return data.status === "cancelled" || data.inspectionStatus === "cancelled";
}

function hasCalendarRelevantChange(before = {}, after = {}) {
  return CALENDAR_RELEVANT_FIELDS.some((key) => String(before[key] ?? "") !== String(after[key] ?? ""));
}

function toIsoDateTime(dateKey, timeValue) {
  const time = String(timeValue || "09:00").slice(0, 5);
  return `${dateKey}T${time}:00`;
}

function addOneHour(time = "") {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  const safeHours = Number.isFinite(hours) ? hours : 9;
  const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
  const endDate = new Date(Date.UTC(2000, 0, 1, safeHours, safeMinutes));
  endDate.setUTCHours(endDate.getUTCHours() + 1);
  return `${String(endDate.getUTCHours()).padStart(2, "0")}:${String(endDate.getUTCMinutes()).padStart(2, "0")}`;
}

function getEventTimes(booking = {}) {
  const dateKey = field(booking, "preferredDate");
  const start = field(booking, "preferredTimeStart", field(booking, "preferredTime", "09:00"));
  const end = field(booking, "preferredTimeEnd", addOneHour(start));

  if (!dateKey) return null;

  return {
    start: {
      dateTime: toIsoDateTime(dateKey, start),
      timeZone: TIME_ZONE
    },
    end: {
      dateTime: toIsoDateTime(dateKey, end),
      timeZone: TIME_ZONE
    }
  };
}

function buildDescription(bookingId, booking = {}) {
  const lines = [
    `Booking reference: ${bookingId}`,
    `Booking status: ${field(booking, "status", "confirmed")}`,
    `Inspection status: ${field(booking, "inspectionStatus", "Not provided")}`,
    `Payment status: ${field(booking, "paymentStatus", "paid")}`,
    `Payment method: ${field(booking, "paymentMethod", "Not provided")}`,
    `Agency: ${field(booking, "agencyName", "Not an agency booking")}`,
    `Agency job reference: ${field(booking, "agencyJobReference", "Not provided")}`,
    `Customer: ${field(booking, "customerName", "Not provided")}`,
    `Phone: ${field(booking, "phone", "Not provided")}`,
    `Email: ${field(booking, "email", "Not provided")}`,
    `Owner: ${field(booking, "ownerName", "Not provided")}`,
    `Property: ${field(booking, "propertyAddress", "Not provided")}`,
    `Inspection reason: ${field(booking, "inspectionReason", "Not provided")}`,
    `Pool type: ${field(booking, "poolType", "Not provided")}`,
    `Access instructions: ${field(booking, "accessInstructions", "No access instructions provided")}`,
    `Notes: ${field(booking, "notes", "No notes provided")}`
  ];

  return lines.join("\n");
}

function eventPrefix(booking = {}) {
  if (booking.status === "completed" || booking.inspectionStatus === "completed") return "Completed Pool Inspection";
  if (booking.status === "certificate_issued" || booking.inspectionStatus === "certificate_issued") return "Certificate Issued";
  if (booking.paymentStatus === "agency_invoice") return "Agency Pool Inspection";
  return "Pool Safety Inspection";
}

function buildCalendarEvent(bookingId, booking = {}) {
  const customerName = field(booking, "customerName", "Client");
  const propertyAddress = field(booking, "propertyAddress", "Inspection property");
  const eventTimes = getEventTimes(booking);

  if (!eventTimes) return null;

  return {
    summary: `${eventPrefix(booking)} - ${customerName}`,
    location: propertyAddress,
    description: buildDescription(bookingId, booking),
    start: eventTimes.start,
    end: eventTimes.end,
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },
        { method: "popup", minutes: 60 }
      ]
    }
  };
}

async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/calendar.events"]
  });
  const authClient = await auth.getClient();
  return google.calendar({ version: "v3", auth: authClient });
}

async function createCalendarEvent(calendar, calendarId, bookingId, booking, ref) {
  const requestBody = buildCalendarEvent(bookingId, booking);
  if (!requestBody) {
    logger.warn("Calendar event skipped because event time is missing", { bookingId });
    return;
  }

  const created = await calendar.events.insert({ calendarId, requestBody });

  await ref.set({
    googleCalendarEventId: created.data.id || null,
    googleCalendarEventLink: created.data.htmlLink || null,
    googleCalendarEventCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    googleCalendarEventUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    googleCalendarEventDeletedAt: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Google Calendar event created for booking", {
    bookingId,
    paymentStatus: booking.paymentStatus || null,
    calendarEventId: created.data.id || null
  });
}

async function updateCalendarEvent(calendar, calendarId, bookingId, booking, ref) {
  const eventId = booking.googleCalendarEventId;
  const requestBody = buildCalendarEvent(bookingId, booking);
  if (!eventId || !requestBody) return;

  const updated = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody
  });

  await ref.set({
    googleCalendarEventLink: updated.data.htmlLink || booking.googleCalendarEventLink || null,
    googleCalendarEventUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Google Calendar event updated for booking", {
    bookingId,
    calendarEventId: eventId
  });
}

async function deleteCalendarEvent(calendar, calendarId, bookingId, booking, ref) {
  const eventId = booking.googleCalendarEventId;
  if (!eventId) return;

  try {
    await calendar.events.delete({ calendarId, eventId });
  } catch (error) {
    if (error.code !== 404) throw error;
  }

  await ref.set({
    googleCalendarEventId: null,
    googleCalendarEventLink: null,
    googleCalendarEventDeletedAt: admin.firestore.FieldValue.serverTimestamp(),
    googleCalendarEventUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Google Calendar event deleted for cancelled booking", {
    bookingId,
    calendarEventId: eventId
  });
}

exports.createCalendarEventAfterPayment = onDocumentUpdated({
  document: "bookings/{bookingId}",
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [GOOGLE_CALENDAR_ID]
}, async (event) => {
  const bookingId = event.params.bookingId;
  const before = event.data?.before?.data() || {};
  const booking = event.data?.after?.data() || {};
  const calendarId = GOOGLE_CALENDAR_ID.value();

  if (!calendarId) {
    logger.warn("Calendar event skipped because calendar ID is missing", { bookingId });
    return;
  }

  const calendar = await getCalendarClient();
  const ref = event.data.after.ref;

  if (isCancelledBooking(booking)) {
    if (booking.googleCalendarEventId) {
      await deleteCalendarEvent(calendar, calendarId, bookingId, booking, ref);
    } else {
      logger.info("Calendar deletion skipped because cancelled booking had no event", { bookingId });
    }
    return;
  }

  if (!isConfirmedBooking(booking)) {
    logger.info("Calendar event skipped because booking is not confirmed", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: booking.paymentStatus || null,
      status: booking.status || null
    });
    return;
  }

  if (!booking.googleCalendarEventId) {
    await createCalendarEvent(calendar, calendarId, bookingId, booking, ref);
    return;
  }

  if (hasJustBecomeConfirmed(before, booking) || hasCalendarRelevantChange(before, booking)) {
    await updateCalendarEvent(calendar, calendarId, bookingId, booking, ref);
    return;
  }

  logger.info("Calendar event skipped because no calendar-relevant fields changed", {
    bookingId,
    calendarEventId: booking.googleCalendarEventId || null
  });
});
