const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const { google } = require("googleapis");
const { createHash } = require("node:crypto");

admin.initializeApp();

const GOOGLE_CALENDAR_ID = defineSecret("GOOGLE_CALENDAR_ID");
const TIME_ZONE = "Australia/Brisbane";
const { planCalendarAction } = require("./calendar-sync-policy");

function field(data, key, fallback = "") {
  const value = data?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
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
    `Client / pool owner: ${field(booking, "poolOwnerName", field(booking, "customerName", "Not provided"))}`,
    `Owner phone: ${field(booking, "poolOwnerPhone", booking.isPropertyOwner ? field(booking, "phone", "Not provided") : "Not provided")}`,
    `Owner email: ${field(booking, "poolOwnerEmail", booking.isPropertyOwner ? field(booking, "email", "Not provided") : "Not provided")}`,
    `Booking contact: ${field(booking, "customerName", "Not provided")}`,
    `Booking contact phone: ${field(booking, "phone", "Not provided")}`,
    `Booking contact email: ${field(booking, "email", "Not provided")}`,
    `Access contact: ${field(booking, "accessContactName", field(booking, "customerName"))}`,
    `Access phone: ${field(booking, "accessContactPhone", field(booking, "phone"))}`,
    `Access method: ${field(booking, "accessMethod", "Not provided")}`,
    `Key collection: ${field(booking, "keyCollectionLocation", "Not applicable")}`,
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
  const customerName = field(booking, "poolOwnerName", field(booking, "customerName", "Client"));
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
  // A stable, Calendar-compatible ID makes a retry after an insert/Firestore
  // failure reuse the existing event instead of creating a duplicate.
  const eventId = "ig" + createHash("sha256").update(bookingId).digest("hex").slice(0, 48);
  if (!requestBody) {
    logger.warn("Calendar event skipped because event time is missing", { bookingId });
    return;
  }

  let created;
  try {
    created = await calendar.events.insert({ calendarId, requestBody: { ...requestBody, id: eventId } });
  } catch (error) {
    if (Number(error.code || error.response?.status) !== 409) throw error;
    // Another invocation may have inserted the same booking event already.
    created = await calendar.events.patch({ calendarId, eventId, requestBody });
  }

  const latest = (await ref.get()).data() || {};
  if (latest.status === "cancelled" || latest.inspectionStatus === "cancelled") {
    try { await calendar.events.delete({ calendarId, eventId }); }
    catch (error) { if (Number(error.code || error.response?.status) !== 404) throw error; }
    await ref.set({ calendarSyncStatus: "synced", calendarSyncError: null }, { merge: true });
    return;
  }

  await ref.set({
    googleCalendarEventId: created.data.id || eventId,
    googleCalendarEventLink: created.data.htmlLink || null,
    googleCalendarEventCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
    googleCalendarEventUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    googleCalendarEventDeletedAt: null,
    calendarSyncStatus: latest.lastAdminActionId === booking.lastAdminActionId ? "synced" : "pending",
    calendarSyncError: null,
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
    calendarSyncStatus: "synced", calendarSyncError: null,
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
    calendarSyncStatus: "synced", calendarSyncError: null,
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
  const ref = event.data.after.ref;
  const action = planCalendarAction(before, booking);
  if (action === "skip") return;

  if (action === "not_linked") {
    await ref.set({ calendarSyncStatus: "not_linked", calendarSyncError: null }, { merge: true });
    return;
  }

  const calendarId = GOOGLE_CALENDAR_ID.value();
  if (!calendarId) {
    logger.error("Calendar sync missing calendar ID", { bookingId, action });
    if (booking.calendarSyncStatus !== "failed") {
      await ref.set({ calendarSyncStatus: "failed",
        calendarSyncError: "GOOGLE_CALENDAR_ID is not configured." }, { merge: true });
    }
    return;
  }

  try {
    const calendar = await getCalendarClient();
    if (action === "delete") {
      await deleteCalendarEvent(calendar, calendarId, bookingId, booking, ref);
    } else if (action === "create") {
      // Recheck before creating an external event: an older trigger may run
      // after the customer has already cancelled their appointment.
      const latest = await ref.get();
      const current = latest.data() || {};
      if (["cancelled", "payment_exception", "payment_expired"].includes(current.status) ||
          current.inspectionStatus === "cancelled") return;
      if (current.googleCalendarEventId) {
        await updateCalendarEvent(calendar, calendarId, bookingId, current, ref);
      } else {
        await createCalendarEvent(calendar, calendarId, bookingId, current, ref);
      }
    } else if (action === "update") {
      const latest = await ref.get();
      const current = latest.data() || {};
      if (["cancelled", "payment_exception", "payment_expired"].includes(current.status) ||
          current.inspectionStatus === "cancelled") return;
      await updateCalendarEvent(calendar, calendarId, bookingId, current, ref);
    }
  } catch (error) {
    logger.error("Booking calendar sync failed", { bookingId, action, message: error.message });
    // Never overwrite the status of a newer successful operation with a stale
    // error from an earlier trigger invocation.
    const latest = await ref.get();
    const current = latest.data() || {};
    if (current.calendarSyncStatus === "pending" &&
        current.lastAdminActionId === booking.lastAdminActionId) {
      await ref.set({
        calendarSyncStatus: "failed",
        calendarSyncError: String(error.message || "Calendar unavailable").slice(0, 180),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    throw error;
  }
});
