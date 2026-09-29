"use strict";

const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "agency_invoice", "no_payment_required"]);
const CALENDAR_RELEVANT_FIELDS = [
  "preferredDate", "preferredTimeStart", "preferredTimeEnd", "preferredTimeLabel",
  "preferredTime", "customerName", "phone", "email", "propertyAddress",
  "inspectionReason", "poolType", "poolOwnerName", "ownerDetailsPending",
  "agencyName", "accessContactName", "accessContactPhone", "accessMethod",
  "keyCollectionLocation", "accessInstructions", "notes",
  "status", "inspectionStatus", "paymentStatus"
];
function confirmed(b = {}) {
  if (["cancelled", "payment_exception", "payment_expired"].includes(b.status)) return false;
  return ["confirmed", "completed", "certificate_issued"].includes(b.status) ||
    CONFIRMED_PAYMENT_STATUSES.has(b.paymentStatus);
}
function cancelled(b = {}) {
  return b.status === "cancelled" || b.inspectionStatus === "cancelled";
}
function relevantChange(before = {}, after = {}) {
  return CALENDAR_RELEVANT_FIELDS.some((field) =>
    String(before[field] ?? "") !== String(after[field] ?? ""));
}
function becameConfirmed(before = {}, after = {}) {
  return !confirmed(before) && confirmed(after);
}
function planCalendarAction(before = {}, after = {}) {
  if (cancelled(after)) {
    if (after.googleCalendarEventId) return "delete";
    // Setting "not_linked" on every cancelled document update creates an
    // infinite Firestore-trigger loop. Only acknowledge a pending request once.
    return after.calendarSyncStatus === "pending" ? "not_linked" : "skip";
  }
  if (!confirmed(after)) return "skip";
  const changed = relevantChange(before, after) || becameConfirmed(before, after);
  if (!after.googleCalendarEventId) {
    return changed || after.calendarSyncStatus === "pending" ? "create" : "skip";
  }
  return changed || after.calendarSyncStatus === "pending" ? "update" : "skip";
}
module.exports = { planCalendarAction, confirmed, cancelled, relevantChange };
