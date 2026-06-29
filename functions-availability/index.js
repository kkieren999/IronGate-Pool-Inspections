const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

admin.initializeApp();

const db = admin.firestore();
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid"]);

function getComparableId(item = {}) {
  if (item.id) return String(item.id);
  if (item.start) return String(item.start).replace(":", "_");
  return "";
}

function hasJustBecomeConfirmed(before = {}, after = {}) {
  return !CONFIRMED_PAYMENT_STATUSES.has(before.paymentStatus) && CONFIRMED_PAYMENT_STATUSES.has(after.paymentStatus);
}

function timeFromSlotId(slotId = "") {
  const match = String(slotId).match(/^(\d{2})_(\d{2})$/);
  if (!match) return "";
  return `${match[1]}:${match[2]}`;
}

function addOneHour(time = "") {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  const start = new Date(Date.UTC(2000, 0, 1, hours, minutes));
  start.setUTCHours(start.getUTCHours() + 1);
  return `${String(start.getUTCHours()).padStart(2, "0")}:${String(start.getUTCMinutes()).padStart(2, "0")}`;
}

function buildLockedSlot(existingSlot = {}, selectedId, bookingId, booking = {}, lockedAt) {
  const start = existingSlot.start || booking.preferredTimeStart || timeFromSlotId(selectedId);
  const end = existingSlot.end || booking.preferredTimeEnd || addOneHour(start);
  const label = existingSlot.label || booking.preferredTimeLabel || booking.preferredTime || (start && end ? `${start} – ${end}` : selectedId);

  return {
    ...existingSlot,
    id: existingSlot.id || selectedId,
    start: start || existingSlot.start || "",
    end: end || existingSlot.end || "",
    label,
    available: false,
    booked: true,
    locked: true,
    bookingId,
    bookedByBookingId: bookingId,
    customerName: booking.customerName || "",
    propertyAddress: booking.propertyAddress || "",
    paymentStatus: booking.paymentStatus || null,
    lockedAt
  };
}

function slotAlreadyLockedByAnotherBooking(slot = {}, bookingId) {
  if (!slot || slot.booked !== true) return false;
  const existingBookingId = slot.bookedByBookingId || slot.bookingId || "";
  return Boolean(existingBookingId && existingBookingId !== bookingId);
}

async function lockAvailabilityForConfirmedBooking(bookingId, booking = {}) {
  const dateKey = booking.preferredDate;
  const selectedId = booking.preferredTimeSlot;

  if (!dateKey || !selectedId) {
    logger.warn("Confirmed booking missing availability date or time", { bookingId, dateKey, selectedId });
    await db.collection("bookings").doc(bookingId).set({
      availabilityLockStatus: "missing_date_or_slot",
      availabilityLockError: "Booking is missing preferredDate or preferredTimeSlot.",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return;
  }

  const availabilityRef = db.collection("availability").doc(dateKey);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const lockedAt = admin.firestore.Timestamp.now();
  let lockStatus = "locked";
  let lockError = null;

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(availabilityRef);

    if (!snapshot.exists) {
      transaction.set(availabilityRef, {
        date: dateKey,
        status: "available",
        slots: {
          [selectedId]: buildLockedSlot({}, selectedId, bookingId, booking, lockedAt)
        },
        updatedAt: lockedAt,
        updatedBy: "stripe_payment_lock"
      }, { merge: true });
      return;
    }

    const data = snapshot.data() || {};
    const current = data.slots;

    if (Array.isArray(current)) {
      let found = false;
      const updated = current.map((item) => {
        if (getComparableId(item) !== selectedId) return item;
        found = true;

        if (slotAlreadyLockedByAnotherBooking(item, bookingId)) {
          lockStatus = "conflict";
          lockError = `Slot is already booked by ${item.bookedByBookingId || item.bookingId}.`;
          return item;
        }

        return buildLockedSlot(item, selectedId, bookingId, booking, lockedAt);
      });

      if (!found) {
        updated.push(buildLockedSlot({}, selectedId, bookingId, booking, lockedAt));
      }

      transaction.set(availabilityRef, {
        slots: updated,
        updatedAt: lockedAt,
        updatedBy: "stripe_payment_lock"
      }, { merge: true });
      return;
    }

    const existingSlots = current && typeof current === "object" ? current : {};
    const existing = existingSlots[selectedId] || {};

    if (slotAlreadyLockedByAnotherBooking(existing, bookingId)) {
      lockStatus = "conflict";
      lockError = `Slot is already booked by ${existing.bookedByBookingId || existing.bookingId}.`;
      return;
    }

    transaction.set(availabilityRef, {
      slots: {
        ...existingSlots,
        [selectedId]: buildLockedSlot(existing, selectedId, bookingId, booking, lockedAt)
      },
      updatedAt: lockedAt,
      updatedBy: "stripe_payment_lock"
    }, { merge: true });
  });

  await bookingRef.set({
    availabilityLockStatus: lockStatus,
    availabilityLocked: lockStatus === "locked",
    availabilityLockError: lockError,
    availabilityLockedAt: lockStatus === "locked" ? admin.firestore.FieldValue.serverTimestamp() : null,
    availabilityLockDate: dateKey,
    availabilityLockSlot: selectedId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
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
    logger.info("Availability lock skipped because booking did not just become paid", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: after.paymentStatus || null
    });
    return;
  }

  await lockAvailabilityForConfirmedBooking(bookingId, after);

  logger.info("Availability lock processed for paid booking", {
    bookingId,
    preferredDate: after.preferredDate || null,
    preferredTimeSlot: after.preferredTimeSlot || null,
    paymentStatus: after.paymentStatus || null
  });
});
