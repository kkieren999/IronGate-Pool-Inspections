const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");

admin.initializeApp();

const GOOGLE_CALENDAR_ID = defineSecret("GOOGLE_CALENDAR_ID");
const TIME_ZONE = "Australia/Brisbane";

function field(data, key, fallback = "") {
  const value = data?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function hasJustBecomePaid(before = {}, after = {}) {
  return before.paymentStatus !== "paid" && after.paymentStatus === "paid";
}

function toIsoDateTime(dateKey, timeValue) {
  const time = String(timeValue || "09:00").slice(0, 5);
  return `${dateKey}T${time}:00`;
}

function getEventTimes(booking = {}) {
  const dateKey = field(booking, "preferredDate");
  const start = field(booking, "preferredTimeStart", field(booking, "preferredTime", "09:00"));
  const end = field(booking, "preferredTimeEnd", "");

  if (!dateKey) return null;

  let endTime = end;
  if (!endTime) {
    const [hours, minutes] = start.split(":").map(Number);
    const safeHours = Number.isFinite(hours) ? hours : 9;
    const safeMinutes = Number.isFinite(minutes) ? minutes : 0;
    const endDate = new Date(Date.UTC(2000, 0, 1, safeHours, safeMinutes));
    endDate.setUTCHours(endDate.getUTCHours() + 1);
    endTime = `${String(endDate.getUTCHours()).padStart(2, "0")}:${String(endDate.getUTCMinutes()).padStart(2, "0")}`;
  }

  return {
    start: {
      dateTime: toIsoDateTime(dateKey, start),
      timeZone: TIME_ZONE
    },
    end: {
      dateTime: toIsoDateTime(dateKey, endTime),
      timeZone: TIME_ZONE
    }
  };
}

function buildDescription(bookingId, booking = {}) {
  const lines = [
    `Booking reference: ${bookingId}`,
    `Payment status: ${field(booking, "paymentStatus", "paid")}`,
    `Customer: ${field(booking, "customerName", "Not provided")}`,
    `Phone: ${field(booking, "phone", "Not provided")}`,
    `Email: ${field(booking, "email", "Not provided")}`,
    `Property: ${field(booking, "propertyAddress", "Not provided")}`,
    `Inspection reason: ${field(booking, "inspectionReason", "Not provided")}`,
    `Pool type: ${field(booking, "poolType", "Not provided")}`,
    `Access instructions: ${field(booking, "accessInstructions", "No access instructions provided")}`,
    `Notes: ${field(booking, "notes", "No notes provided")}`
  ];

  return lines.join("\n");
}

async function getCalendarClient() {
  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/calendar.events"]
  });
  const authClient = await auth.getClient();
  return google.calendar({ version: "v3", auth: authClient });
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

  if (!hasJustBecomePaid(before, booking)) {
    logger.info("Calendar event skipped because booking did not just become paid", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: booking.paymentStatus || null
    });
    return;
  }

  if (booking.googleCalendarEventId) {
    logger.info("Calendar event skipped because booking already has a calendar event", {
      bookingId,
      googleCalendarEventId: booking.googleCalendarEventId
    });
    return;
  }

  const calendarId = GOOGLE_CALENDAR_ID.value();
  const eventTimes = getEventTimes(booking);

  if (!calendarId || !eventTimes) {
    logger.warn("Calendar event skipped because calendar ID or event time is missing", {
      bookingId,
      hasCalendarId: Boolean(calendarId),
      hasEventTimes: Boolean(eventTimes)
    });
    return;
  }

  const calendar = await getCalendarClient();
  const customerName = field(booking, "customerName", "Client");
  const propertyAddress = field(booking, "propertyAddress", "Inspection property");

  const created = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Pool Safety Inspection - ${customerName}`,
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
    }
  });

  await event.data.after.ref.set({
    googleCalendarEventId: created.data.id || null,
    googleCalendarEventLink: created.data.htmlLink || null,
    googleCalendarEventCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Google Calendar event created for paid booking", {
    bookingId,
    calendarEventId: created.data.id || null
  });
});
