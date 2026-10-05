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

const EDITABLE_BOOKING_FIELDS = Object.freeze({
  customerName: { min: 2, max: 140, required: true },
  email: { min: 3, max: 180, required: true, email: true },
  phone: { min: 6, max: 30, required: true },
  propertyAddress: { min: 8, max: 400, required: true },
  agencyName: { max: 180 },
  bookingRelationship: { max: 180 },
  poolOwnerName: { max: 180 },
  poolOwnerEmail: { max: 180, email: true },
  poolOwnerPhone: { max: 22 },
  accessContactName: { max: 140 },
  accessContactPhone: { max: 30 },
  accessContactEmail: { max: 180, email: true },
  accessContactAgency: { max: 180 },
  keyCollectionLocation: { max: 300 },
  accessInstructions: { max: 1200 },
  notes: { max: 2000 }
});

function normaliseEditableDetails(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpsError("invalid-argument", "Booking details are required.");
  }
  const keys = Object.keys(raw);
  if (!keys.length) throw new HttpsError("invalid-argument", "No booking detail changes were supplied.");
  const unexpected = keys.filter((key) => !Object.prototype.hasOwnProperty.call(EDITABLE_BOOKING_FIELDS, key));
  if (unexpected.length) {
    throw new HttpsError("invalid-argument", "One or more booking fields are not editable.");
  }
  const output = {};
  for (const key of keys) {
    const spec = EDITABLE_BOOKING_FIELDS[key];
    if (typeof raw[key] !== "string") throw new HttpsError("invalid-argument", key + " must be text.");
    const value = raw[key].trim();
    if (spec.required && value.length < (spec.min || 1)) {
      throw new HttpsError("invalid-argument", key + " is required.");
    }
    if (value.length > spec.max) throw new HttpsError("invalid-argument", key + " is too long.");
    if (spec.email && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new HttpsError("invalid-argument", key + " must be a valid email address.");
    }
    output[key] = value;
  }
  return output;
}

function sameText(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

async function updateAdminBookingDetails(request) {
  const actor = await requireAdmin(request);
  const data = request.data || {};
  const bookingId = validId(data.bookingId, "booking ID");
  const actionId = validId(data.actionId || randomUUID(), "action ID");
  const requested = normaliseEditableDetails(data.details);
  const bookingRef = db.collection("bookings").doc(bookingId);
  const auditRef = db.collection("adminActivity").doc(bookingId + "_" + actionId);
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  return db.runTransaction(async (tx) => {
    const audit = await tx.get(auditRef);
    if (audit.exists) {
      const prior = audit.data() || {};
      if (prior.bookingId !== bookingId || prior.action !== "details_edit" || prior.actorUid !== actor.uid) {
        throw new HttpsError("already-exists", "Action ID already used for another operation.");
      }
      return { bookingId, actionId, action: "details_edit", alreadyApplied: true, changedFields: prior.changedFields || [] };
    }

    const snapshot = await tx.get(bookingRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = snapshot.data() || {};
    const changes = {};
    for (const [key, value] of Object.entries(requested)) {
      if (!sameText(booking[key], value)) changes[key] = value;
    }

    // Keep fields that explicitly represent "same person as booking contact" in sync,
    // but only when they were not separately edited and still matched the old contact.
    if (Object.prototype.hasOwnProperty.call(changes, "customerName")) {
      if (booking.isPropertyOwner === true &&
          !Object.prototype.hasOwnProperty.call(requested, "poolOwnerName") &&
          (!booking.poolOwnerName || sameText(booking.poolOwnerName, booking.customerName))) {
        changes.poolOwnerName = changes.customerName;
      }
      if (booking.accessSameAsBooking === true &&
          !Object.prototype.hasOwnProperty.call(requested, "accessContactName") &&
          (!booking.accessContactName || sameText(booking.accessContactName, booking.customerName))) {
        changes.accessContactName = changes.customerName;
      }
    }
    if (Object.prototype.hasOwnProperty.call(changes, "email")) {
      if (booking.isPropertyOwner === true &&
          !Object.prototype.hasOwnProperty.call(requested, "poolOwnerEmail") &&
          (!booking.poolOwnerEmail || sameText(booking.poolOwnerEmail, booking.email))) {
        changes.poolOwnerEmail = changes.email;
      }
      if (booking.accessSameAsBooking === true &&
          !Object.prototype.hasOwnProperty.call(requested, "accessContactEmail") &&
          (!booking.accessContactEmail || sameText(booking.accessContactEmail, booking.email))) {
        changes.accessContactEmail = changes.email;
      }
    }
    if (Object.prototype.hasOwnProperty.call(changes, "phone")) {
      if (booking.isPropertyOwner === true &&
          !Object.prototype.hasOwnProperty.call(requested, "poolOwnerPhone") &&
          (!booking.poolOwnerPhone || sameText(booking.poolOwnerPhone, booking.phone))) {
        changes.poolOwnerPhone = changes.phone;
      }
      if (booking.accessSameAsBooking === true &&
          !Object.prototype.hasOwnProperty.call(requested, "accessContactPhone") &&
          (!booking.accessContactPhone || sameText(booking.accessContactPhone, booking.phone))) {
        changes.accessContactPhone = changes.phone;
      }
    }

    if (Object.prototype.hasOwnProperty.call(changes, "propertyAddress")) {
      Object.assign(changes, {
        propertyAddressSelected: true,
        propertyPlaceId: "",
        selectedAddress: changes.propertyAddress,
        poolRegisterStatus: "admin_address_changed",
        poolRegisterMessage: "Address changed in admin; recheck the Queensland pool register if required.",
        poolRegisterDetails: null,
        poolRegisterCheckedAt: null,
        poolRegisterLooksRight: false,
        poolRegisterLookupSource: "admin_edit"
      });
    }

    const changedFields = Object.keys(changes);
    if (!changedFields.length) {
      return { bookingId, actionId, action: "details_edit", alreadyApplied: false, noChanges: true, changedFields: [] };
    }

    tx.update(bookingRef, {
      ...changes,
      lastAdminActionId: actionId,
      lastAdminActionType: "details_edit",
      updatedAt: stamp,
      updatedBy: actor.email
    });
    tx.create(auditRef, {
      bookingId,
      action: "details_edit",
      actionId,
      actorUid: actor.uid,
      actorEmail: actor.email,
      changedFields,
      reason: "Booking details edited in admin",
      createdAt: stamp
    });
    return { bookingId, actionId, action: "details_edit", alreadyApplied: false, changedFields, details: changes };
  });
}

module.exports = { requireAdmin, executeAdminBookingChange, updateAdminBookingDetails };
