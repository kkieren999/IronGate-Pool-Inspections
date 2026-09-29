"use strict";

// Pure slot planner shared by admin move/cancel transactions. No Firebase or Stripe
// calls are made here, so ownership/conflict cases can be unit-tested independently.
class BookingOperationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(message) { throw new BookingOperationError("failed-precondition", message); }
function slotId(slot) { return String(slot?.id || slot?.start?.replace(":", "_") || ""); }
function slotMap(raw) {
  const values = Array.isArray(raw) ? raw : Object.values(raw || {});
  return new Map(values.filter(Boolean).map((slot) => [slotId(slot), { ...slot }]).filter(([id]) => id));
}
function serialise(slots, raw) {
  return Array.isArray(raw) ? [...slots.values()] : Object.fromEntries(slots);
}
function owned(slot, id) {
  return Boolean(slot && (slot.bookingId === id || slot.bookedByBookingId === id));
}
function free(slot) {
  return Boolean(slot && slot.available === true && slot.booked !== true &&
    slot.locked !== true && slot.reserved !== true);
}
function addHour(time) {
  const [hour, minute] = String(time || "").split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 22) fail("Invalid slot time.");
  return String(hour + 1).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}
function slotAfter(slot) {
  return String(slot.end || addHour(slot.start)).replace(":", "_");
}
function cleanReleased(slot, reopen) {
  if (slot.privateInvite === true && Object.prototype.hasOwnProperty.call(slot, "privateInviteOriginal")) {
    return slot.privateInviteOriginal === null ? null : { ...slot.privateInviteOriginal };
  }
  if (slot.adminCreatedBuffer === true) return null;
  const copy = { ...slot };
  for (const key of ["bookingId", "bookedByBookingId", "customerName", "propertyAddress",
    "paymentStatus", "reservedAt", "bufferForSlot", "bufferSlot", "privateInvite",
    "privateInviteToken", "privateInviteOriginal", "adminCreatedBuffer"]) delete copy[key];
  return {
    ...copy, available: reopen, booked: false, locked: false, reserved: false,
    reservationStatus: reopen ? "admin_released" : "admin_closed"
  };
}
function releaseBooking(raw, bookingId, selectedId, reopen) {
  const slots = slotMap(raw);
  const selected = slots.get(selectedId);
  if (!owned(selected, bookingId)) fail("The existing appointment slot is no longer owned by this booking. Refresh before changing it.");
  for (const [id, slot] of slots) {
    if (!owned(slot, bookingId)) continue;
    if (id !== selectedId && slot.bufferForSlot !== selectedId) continue;
    const replacement = cleanReleased(slot, reopen);
    if (replacement) slots.set(id, replacement);
    else slots.delete(id);
  }
  return serialise(slots, raw);
}
function reserveBooking(raw, bookingId, selectedId, booking, dateKey, reservedAt) {
  const slots = slotMap(raw);
  const selected = slots.get(selectedId);
  if (!free(selected)) fail("The replacement inspection time is no longer available.");
  const bufferId = slotAfter(selected);
  if (bufferId === selectedId) fail("Invalid following buffer slot.");
  const buffer = slots.get(bufferId);
  if (buffer && !free(buffer)) fail("The following one-hour buffer is unavailable.");
  const selectedStart = String(selected.start || selectedId.replace("_", ":"));
  const selectedEnd = String(selected.end || addHour(selectedStart));
  const label = String(selected.label || selectedStart + " - " + selectedEnd);
  const common = {
    available: false, booked: true, locked: true, reserved: true,
    bookingId, bookedByBookingId: bookingId,
    customerName: booking.customerName || "", propertyAddress: booking.propertyAddress || "",
    paymentStatus: booking.paymentStatus || "paid", reservedAt
  };
  slots.set(selectedId, { ...selected, ...common, reservationStatus: "admin_rescheduled", bufferSlot: false, bufferForSlot: null });
  slots.set(bufferId, {
    ...(buffer || { id: bufferId, start: selectedEnd, end: addHour(selectedEnd),
      label: selectedEnd + " - " + addHour(selectedEnd), adminCreatedBuffer: true }),
    ...common, bufferSlot: true, bufferForSlot: selectedId, reservationStatus: "admin_rescheduled_buffer"
  });
  return {
    slots: serialise(slots, raw),
    selected: { id: selectedId, start: selectedStart, end: selectedEnd, label, bufferId, date: dateKey }
  };
}
function todayKey(clock = new Date()) {
  const p = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(clock).reduce((out, part) => { out[part.type] = part.value; return out; }, {});
  return { date: p.year + "-" + p.month + "-" + p.day, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function validateMoveRequest(date, id, clock = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    throw new BookingOperationError("invalid-argument", "Choose a valid inspection date.");
  }
  if (!/^([01]\d|2[0-2])_[0-5]\d$/.test(id)) {
    throw new BookingOperationError("invalid-argument", "Choose a valid inspection time.");
  }
  const now = todayKey(clock);
  if (date < now.date || (date === now.date &&
    Number(id.slice(0, 2)) * 60 + Number(id.slice(3)) <= now.minutes)) {
    fail("Choose a future date and inspection time.");
  }
}
function assertEditable(booking) {
  if (!booking || ["cancelled", "completed", "certificate_issued"].includes(booking.status) ||
      ["cancelled", "completed", "certificate_issued"].includes(booking.inspectionStatus)) {
    fail("This booking cannot be moved or cancelled in its current state.");
  }
  if (!["paid", "no_payment_required", "agency_invoice"].includes(booking.paymentStatus) ||
      booking.status !== "confirmed") fail("Only confirmed bookings can be changed here.");
  if (!booking.preferredDate || !booking.preferredTimeSlot) fail("This booking has no reserved appointment.");
}
module.exports = { BookingOperationError, slotId, slotMap, serialise, free, owned,
  releaseBooking, reserveBooking, todayKey, validateMoveRequest, assertEditable };
