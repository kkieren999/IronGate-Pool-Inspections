const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();

function getComparableId(item = {}) {
  if (item.id) return String(item.id);
  if (item.start) return String(item.start).replace(":", "_");
  return "";
}

function hasJustBecomePaid(before = {}, after = {}) {
  return before.paymentStatus !== "paid" && after.paymentStatus === "paid";
}

async function lockAvailabilityForPaidBooking(bookingId, booking = {}) {
  const dateKey = booking.preferredDate;
  const selectedId = booking.preferredTimeSlot;

  if (!dateKey || !selectedId) {
    logger.warn("Paid booking missing availability date or time", { bookingId, dateKey, selectedId });
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
            lockedAt
          }
        },
        lockedBookings: {
          ...(data.lockedBookings || {}),
          [bookingId]: {
            bookingId,
            selectedId,
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

  if (!hasJustBecomePaid(before, after)) {
    logger.info("Availability lock skipped because booking did not just become paid", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: after.paymentStatus || null
    });
    return;
  }

  await lockAvailabilityForPaidBooking(bookingId, after);

  logger.info("Availability locked for paid booking", {
    bookingId,
    preferredDate: after.preferredDate || null,
    preferredTimeSlot: after.preferredTimeSlot || null
  });
});
