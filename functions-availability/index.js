const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "agency_invoice"]);

function getComparableId(item = {}) {
  if (item.id) return String(item.id);
  if (item.start) return String(item.start).replace(":", "_");
  return "";
}

function hasJustBecomeConfirmed(before = {}, after = {}) {
  return !CONFIRMED_PAYMENT_STATUSES.has(before.paymentStatus) && CONFIRMED_PAYMENT_STATUSES.has(after.paymentStatus);
}

async function lockAvailabilityForConfirmedBooking(bookingId, booking = {}) {
  const dateKey = booking.preferredDate;
  const selectedId = booking.preferredTimeSlot;

  if (!dateKey || !selectedId) {
    logger.warn("Confirmed booking missing availability date or time", { bookingId, dateKey, selectedId });
    return;
  }

  const availabilityRef = db.collection("availability").doc(dateKey);
  const lockedAt = admin.firestore.Timestamp.now();

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(availabilityRef);

    if (!snapshot.exists) {
      transaction.set(availabilityRef, {
        date: dateKey,
        lockedBookings: {
          [bookingId]: {
            bookingId,
            selectedId,
            paymentStatus: booking.paymentStatus || null,
            lockedAt
          }
        },
        updatedAt: lockedAt
      }, { merge: true });
      return;
    }

    const data = snapshot.data() || {};
    const current = data.slots;

    if (Array.isArray(current)) {
      const updated = current.map((item) => {
        if (getComparableId(item) !== selectedId) return item;
        return {
          ...item,
          available: false,
          booked: true,
          bookingId,
          paymentStatus: booking.paymentStatus || null,
          lockedAt
        };
      });

      transaction.set(availabilityRef, {
        slots: updated,
        lockedBookings: {
          ...(data.lockedBookings || {}),
          [bookingId]: {
            bookingId,
            selectedId,
            paymentStatus: booking.paymentStatus || null,
            lockedAt
          }
        },
        updatedAt: lockedAt
      }, { merge: true });
      return;
    }

    if (current && typeof current === "object") {
      const existing = current[selectedId] || {};
      transaction.set(availabilityRef, {
        slots: {
          ...current,
          [selectedId]: {
            ...existing,
            available: false,
            booked: true,
            bookingId,
            paymentStatus: booking.paymentStatus || null,
            lockedAt
          }
        },
        lockedBookings: {
          ...(data.lockedBookings || {}),
          [bookingId]: {
            bookingId,
            selectedId,
            paymentStatus: booking.paymentStatus || null,
            lockedAt
          }
        },
        updatedAt: lockedAt
      }, { merge: true });
    }
  });
}

exports.lockAvailabilityAfterPayment = onDocumentUpdated({
  document: "bookings/{bookingId}",
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB"
}, async (event) => {
  const bookingId = event.params.bookingId;
  const before = event.data?.before?.data() || {};
  const after = event.data?.after?.data() || {};

  if (!hasJustBecomeConfirmed(before, after)) {
    logger.info("Availability lock skipped because booking did not just become confirmed", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: after.paymentStatus || null
    });
    return;
  }

  await lockAvailabilityForConfirmedBooking(bookingId, after);

  logger.info("Availability locked for confirmed booking", {
    bookingId,
    preferredDate: after.preferredDate || null,
    preferredTimeSlot: after.preferredTimeSlot || null,
    paymentStatus: after.paymentStatus || null
  });
});
