import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { planCalendarAction } = require("../functions-calendar/calendar-sync-policy.js");
const ops = require("../functions-payments/admin-booking-operations.js");

test("cancelled booking calendar metadata must not trigger another write indefinitely", () => {
  const pending = { status: "cancelled", paymentStatus: "paid", calendarSyncStatus: "pending" };
  assert.equal(planCalendarAction({}, pending), "not_linked");
  assert.equal(planCalendarAction(pending, { ...pending, calendarSyncStatus: "not_linked" }), "skip");
  assert.equal(planCalendarAction(pending, { ...pending, calendarSyncStatus: "synced" }), "skip");
  assert.equal(planCalendarAction(pending, { ...pending, calendarSyncStatus: "failed" }), "skip");
  const linked = { ...pending, googleCalendarEventId: "google_id_123" };
  assert.equal(planCalendarAction(pending, linked), "delete");
});

test("calendar updates on a move, skips a refund-only update, and does not resurrect cancellation", () => {
  const booking = { status: "confirmed", paymentStatus: "paid", preferredDate: "2099-05-03",
    googleCalendarEventId: "google_id_123", calendarSyncStatus: "synced" };
  assert.equal(planCalendarAction(booking, { ...booking, preferredDate: "2099-05-04", calendarSyncStatus: "pending" }), "update");
  assert.equal(planCalendarAction(booking, { ...booking, refundStatus: "refunded" }), "skip");
  assert.equal(planCalendarAction(booking, { ...booking, calendarSyncStatus: "pending" }), "update");
  assert.equal(planCalendarAction(booking, { ...booking, status: "cancelled", calendarSyncStatus: "pending" }), "delete");
  assert.equal(planCalendarAction({}, { status: "pending_payment", paymentStatus: "checkout_created" }), "skip");
  assert.equal(planCalendarAction({}, { status: "payment_exception", paymentStatus: "paid" }), "skip");
  assert.equal(planCalendarAction({}, { status: "confirmed", paymentStatus: "paid", calendarSyncStatus: "pending" }), "create");
});

test("cancel/move removes only synthetic buffers and never publicly reopens legacy unmarked buffers", () => {
  const id = "booking_sample_123456789";
  const make = (start, extras={}) => ({
    id: start.replace(":", "_"), start, end: String(Number(start.slice(0,2))+1).padStart(2, "0")+":00",
    available: false, booked: true, locked: true, reserved: true, bookingId: id, ...extras
  });
  const slots = {
    "09_00": make("09:00"),
    "10_00": make("10:00", { bufferSlot: true, bufferForSlot: "09_00", bookingCreatedBuffer: true }),
    "11_00": make("11:00", { bookingId: "another_booking" })
  };
  const released = ops.releaseBooking(slots, id, "09_00", true);
  assert.equal(released["09_00"].available, true);
  assert.equal(released["10_00"], undefined);
  assert.equal(released["11_00"].bookingId, "another_booking");
  const existing = ops.releaseBooking({
    "09_00": make("09:00"),
    "10_00": make("10:00", { bufferSlot: true, bufferForSlot: "09_00", bookingCreatedBuffer: false })
  }, id, "09_00", true);
  assert.equal(existing["10_00"].available, true);
  const unknown = ops.releaseBooking({
    "09_00": make("09:00"),
    "10_00": make("10:00", { bufferSlot: true, bufferForSlot: "09_00" })
  }, id, "09_00", true);
  assert.equal(unknown["10_00"].available, false);
  assert.equal(unknown["10_00"].reservationStatus, "admin_closed");
});

test("checkout and expiry code preserve synthetic buffer provenance", () => {
  const direct = readFileSync(new URL("../functions-payments/direct-booking.js", import.meta.url), "utf8");
  const webhook = readFileSync(new URL("../functions-payments/index.js", import.meta.url), "utf8");
  assert.match(direct, /bookingCreatedBuffer: synthetic/);
  assert.match(direct, /reservedAt, true\)/);
  assert.match(webhook, /existingSlot\.bookingCreatedBuffer === true/);
  assert.match(webhook, /slots = current\.flatMap/);
  assert.match(webhook, /else delete slots\[id\]/);
});
