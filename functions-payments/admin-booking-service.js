"use strict";
const admin = require("firebase-admin");
const { HttpsError } = require("firebase-functions/v2/https");
const { randomUUID } = require("node:crypto");
const {
  BookingOperationError, releaseBooking, reserveBooking, validateMoveRequest, assertEditable
} = require("./admin-booking-operations");
const db = admin.firestore();
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";

async function requireAdmin(request) {
  const uid = request.auth?.uid;
  const tokenEmail = String(request.auth?.token?.email || "").toLowerCase();
  if (!uid || tokenEmail !== ADMIN_EMAIL) throw new HttpsError("permission-denied", "Admin sign-in required.");
  // Do not trust a caller-provided email or stale token alone.
  const user = await admin.auth().getUser(uid);
  if (user.disabled || String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "Admin account is not authorised.");
  }
  return { uid: user.uid, email: ADMIN_EMAIL };
}
function requiredString(value, label, min = 1, max = 500) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new HttpsError("invalid-argument", label + " must be " + min + "-" + max + " characters.");
  }
  return value.trim();
}
function validId(value, label) {
  const id = requiredString(value, label, 16, 110);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new HttpsError("invalid-argument", "Invalid " + label + ".");
  return id;
}
function displayDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", { weekday: "long", day: "numeric", month: "long",
    year: "numeric", timeZone: "Australia/Brisbane" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
async function executeAdminBookingChange(request, kind) {
  const actor = await requireAdmin(request);
  const data = request.data || {};
  const bookingId = validId(data.bookingId, "booking ID");
  const actionId = validId(data.actionId || randomUUID(), "action ID");
  const reason = requiredString(data.reason, "Reason", 8, 500);
  const reopenOldSlot = data.reopenOldSlot === true;
  const newDate = kind === "move" ? requiredString(data.date, "Date", 10, 10) : "";
  const newSlotId = kind === "move" ? requiredString(data.slotId, "Time", 5, 5) : "";
  const refundDecision = kind === "cancel"
    ? requiredString(data.refundDecision, "Refund decision", 1, 20) : "";
  if (kind === "cancel" && !["no_refund", "review_refund"].includes(refundDecision)) {
    throw new HttpsError("invalid-argument", "Choose a refund decision for this cancellation.");
  }
  if (kind === "move") validateMoveRequest(newDate, newSlotId);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const auditRef = db.collection("adminActivity").doc(bookingId + "_" + actionId);
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  const reservedAt = admin.firestore.Timestamp.now();
  try {
    return await db.runTransaction(async (tx) => {
      const audit = await tx.get(auditRef);
      if (audit.exists) {
        const prior = audit.data() || {};
        if (prior.bookingId !== bookingId || prior.action !== kind || prior.actorUid !== actor.uid) {
          throw new HttpsError("already-exists", "Action ID already used for another operation.");
        }
        return { bookingId, actionId, action: kind, alreadyApplied: true };
      }
      const snapshot = await tx.get(bookingRef);
      if (!snapshot.exists) throw new HttpsError("not-found", "Booking not found.");
      const booking = snapshot.data() || {};
      assertEditable(booking);
      if (kind === "move" && booking.preferredDate === newDate && booking.preferredTimeSlot === newSlotId) {
        throw new HttpsError("failed-precondition", "Choose a different date or time.");
      }
      const oldRef = db.collection("availability").doc(booking.preferredDate);
      const oldSnap = await tx.get(oldRef);
      if (!oldSnap.exists) throw new HttpsError("failed-precondition", "Original availability is missing; review the booking manually.");
      const newRef = kind === "move" ? db.collection("availability").doc(newDate) : null;
      const newSnap = kind === "move" && newDate !== booking.preferredDate ? await tx.get(newRef) : oldSnap;
      if (kind === "move" && !newSnap.exists) throw new HttpsError("failed-precondition", "The target day has no available times.");
      const oldSlots = (oldSnap.data() || {}).slots;
      if (!oldSlots) throw new HttpsError("failed-precondition", "Original appointment slots are missing.");
      const released = releaseBooking(oldSlots, bookingId, booking.preferredTimeSlot, reopenOldSlot);
      let patch = {};
      if (kind === "move") {
        const targetRaw = newDate === booking.preferredDate ? released : (newSnap.data() || {}).slots;
        const result = reserveBooking(targetRaw, bookingId, newSlotId, booking, newDate, reservedAt);
        tx.set(oldRef, {
          slots: newDate === booking.preferredDate ? result.slots : released,
          updatedAt: stamp, updatedBy: "admin_booking_move"
        }, { merge: true });
        if (newDate !== booking.preferredDate) tx.set(newRef, {
          slots: result.slots, updatedAt: stamp, updatedBy: "admin_booking_move"
        }, { merge: true });
        patch = {
          previousPreferredDate: booking.preferredDate,
          previousPreferredTimeLabel: booking.preferredTimeLabel || booking.preferredTime || "",
          preferredDate: newDate, preferredDateDisplay: displayDate(newDate),
          preferredTimeSlot: result.selected.id, preferredTimeStart: result.selected.start,
          preferredTimeEnd: result.selected.end, preferredTimeLabel: result.selected.label,
          preferredTime: result.selected.label, availabilityLockDate: newDate,
          availabilityLockSlot: result.selected.id, availabilityLocked: true,
          availabilityLockStatus: "locked", availabilityLockError: null,
          availabilityReservationStatus: "confirmed",
          customerNotificationType: "booking_moved"
        };
      } else {
        tx.set(oldRef, { slots: released, updatedAt: stamp, updatedBy: "admin_booking_cancel" }, { merge: true });
        patch = {
          status: "cancelled", inspectionStatus: "cancelled",
          cancellationReason: reason, cancelledAt: stamp, cancelledBy: actor.email,
          cancellationRefundDecision: refundDecision,
          availabilityLocked: false, availabilityLockStatus: "cancelled",
          availabilityReservationStatus: "released",
          customerNotificationType: "booking_cancelled"
        };
      }
      tx.update(bookingRef, {
        ...patch, customerNotificationId: actionId,
        customerNotificationError: null, calendarSequence: Number(booking.calendarSequence || 0) + 1,
        calendarSyncStatus: "pending", adminNote: reason, lastAdminActionId: actionId,
        lastAdminActionType: kind, updatedAt: stamp, updatedBy: actor.email
      });
      tx.create(auditRef, {
        bookingId, action: kind, actionId, actorUid: actor.uid, actorEmail: actor.email,
        reason, previousDate: booking.preferredDate, previousTimeSlot: booking.preferredTimeSlot,
        newDate: kind === "move" ? newDate : null,
        newTimeSlot: kind === "move" ? newSlotId : null,
        reopenOldSlot, refundDecision: refundDecision || null, createdAt: stamp
      });
      return { bookingId, actionId, action: kind, alreadyApplied: false };
    });
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (error instanceof BookingOperationError) throw new HttpsError(error.code, error.message);
    throw error;
  }
}
module.exports = { requireAdmin, executeAdminBookingChange };
