import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const op = require("../functions-payments/admin-booking-operations.js");
const regular = (id, start, end, extras = {}) => ({
  id, start, end, label: start + " - " + end, available: true,
  booked: false, locked: false, reserved: false, ...extras
});
const bookingId = "booking_test_123456789";
const booking = {
  customerName: "Example", propertyAddress: "Test Street",
  status: "confirmed", paymentStatus: "paid",
  preferredDate: "2099-01-04", preferredTimeSlot: "09_00",
  preferredTimeStart: "09:00", preferredTimeEnd: "10:00",
  preferredTimeLabel: "9 am"
};

test("move planner reserves selected slot plus following buffer and restores old booking slots", () => {
  const old = {
    "09_00": regular("09_00", "09:00", "10:00", {
      available: false, booked: true, locked: true, reserved: true, bookingId
    }),
    "10_00": regular("10_00", "10:00", "11:00", {
      available: false, booked: true, locked: true, reserved: true,
      bookedByBookingId: bookingId, bufferForSlot: "09_00"
    })
  };
  const released = op.releaseBooking(old, bookingId, "09_00", true);
  assert.equal(released["09_00"].available, true);
  assert.equal(released["10_00"].available, true);
  assert.ok(!("bookingId" in released["09_00"]));
  const target = { "12_00": regular("12_00", "12:00", "13:00"),
    "13_00": regular("13_00", "13:00", "14:00") };
  const result = op.reserveBooking(target, bookingId, "12_00", booking, "2099-01-05", "now");
  assert.equal(result.selected.start, "12:00");
  assert.equal(result.slots["12_00"].bookingId, bookingId);
  assert.equal(result.slots["12_00"].available, false);
  assert.equal(result.slots["13_00"].bufferForSlot, "12_00");
  assert.equal(result.slots["13_00"].reserved, true);
});

test("planner rejects conflicting target and does not release another booking", () => {
  const other = "another_booking_123456";
  assert.throws(() => op.releaseBooking({
    "09_00": regular("09_00", "09:00", "10:00", { booked: true, bookingId: other })
  }, bookingId, "09_00", true), /no longer owned/);
  assert.throws(() => op.reserveBooking({
    "12_00": regular("12_00", "12:00", "13:00"),
    "13_00": regular("13_00", "13:00", "14:00", { reserved: true, bookingId: other })
  }, bookingId, "12_00", booking, "2099-01-05", "now"), /buffer is unavailable/);
});

test("planner preserves array layout and restores a private invitation's original state", () => {
  const old = [
    regular("09_00", "09:00", "10:00", {
      available: false, booked: true, privateInvite: true, bookingId,
      privateInviteOriginal: regular("09_00", "09:00", "10:00")
    }),
    regular("10_00", "10:00", "11:00", {
      available: false, booked: true, privateInvite: true, bookingId,
      bufferForSlot: "09_00", privateInviteOriginal: null
    })
  ];
  const released = op.releaseBooking(old, bookingId, "09_00", false);
  assert.ok(Array.isArray(released));
  assert.equal(released.length, 1);
  assert.equal(released[0].available, true);
  assert.equal(released[0].privateInvite, undefined);
  assert.equal(released[0].bookingId, undefined);
  const target = op.reserveBooking([regular("12_00", "12:00", "13:00")],
    bookingId, "12_00", booking, "2099-01-05", "now");
  assert.ok(Array.isArray(target.slots));
  assert.equal(target.slots.length, 2);
  assert.equal(target.slots[1].adminCreatedBuffer, true);
  const cleaned = op.releaseBooking(target.slots, bookingId, "12_00", true);
  assert.equal(cleaned.length, 1, "synthetic buffer removed on release");
});

test("booking state and Brisbane date-time validation reject unsafe moves", () => {
  op.validateMoveRequest("2099-01-05", "12_00", new Date("2026-09-29T00:00:00Z"));
  assert.throws(() => op.validateMoveRequest("2026-01-01", "12_00", new Date("2026-09-29T00:00:00Z")), /future date/);
  assert.throws(() => op.validateMoveRequest("2099-02-30", "12_00"), /valid inspection date/);
  assert.throws(() => op.validateMoveRequest("2099-01-05", "unsafe"), /valid inspection time/);
  assert.throws(() => op.assertEditable({ ...booking, status: "cancelled" }), /cannot be moved/);
  assert.throws(() => op.assertEditable({ ...booking, paymentStatus: "checkout_created" }), /Only confirmed/);
  assert.doesNotThrow(() => op.assertEditable(booking));
});

test("backend authorises existing owner account and writes both availability days plus immutable audit atomically", async () => {
  const writes = new Map();
  const store = new Map();
  const oldSlot = regular("09_00", "09:00", "10:00", {
    available: false, booked: true, locked: true, reserved: true, bookingId
  });
  store.set("bookings/" + bookingId, { ...booking });
  store.set("availability/2099-01-04", { slots: { "09_00": oldSlot } });
  store.set("availability/2099-01-05", { slots: {
    "12_00": regular("12_00", "12:00", "13:00"),
    "13_00": regular("13_00", "13:00", "14:00")
  } });
  const db = {
    collection(name) { return { doc(id) { return { path: name + "/" + id }; } }; },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const data = store.get(ref.path);
          return { exists: data !== undefined, data() { return structuredClone(data); } };
        },
        set(ref, data, opts) { writes.set(ref.path, { ...(opts?.merge ? store.get(ref.path) || {} : {}), ...data }); },
        update(ref, data) { writes.set(ref.path, { ...(store.get(ref.path) || {}), ...data }); },
        create(ref, data) { if (store.has(ref.path)) throw Error("already exists"); writes.set(ref.path, data); }
      };
      const result = await fn(tx);
      for (const [key, value] of writes) store.set(key, value);
      writes.clear();
      return result;
    }
  };
  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }
  const admin = {
    firestore() { return db; },
    auth() { return { async getUser() { return { uid: "owner-uid", email: "irongate.pool.bne@gmail.com", disabled: false }; } }; }
  };
  admin.firestore.FieldValue = { serverTimestamp: () => "now" };
  admin.firestore.Timestamp = { now: () => "now" };
  const source = readFileSync(new URL("../functions-payments/admin-booking-service.js", import.meta.url), "utf8");
  const sandbox = {
    module: { exports: {} },
    require(id) {
      if (id === "firebase-admin") return admin;
      if (id === "firebase-functions/v2/https") return { HttpsError };
      if (id === "node:crypto") return { randomUUID: () => "sample-action-id-123456789" };
      if (id === "./admin-booking-operations") return op;
      throw Error("Unexpected require: " + id);
    }
  };
  runInNewContext(source, sandbox);
  const service = sandbox.module.exports;
  const request = { auth: { uid: "owner-uid", token: { email: "irongate.pool.bne@gmail.com" } },
    data: { bookingId, actionId: "action_1234567890123456", date: "2099-01-05", slotId: "12_00",
      reason: "Customer requested a new appointment", reopenOldSlot: true } };
  await assert.rejects(service.requireAdmin({ auth: { uid: "owner-uid", token: { email: "not-admin@example.com" } } }), /Admin sign-in required/);
  const done = await service.executeAdminBookingChange(request, "move");
  assert.equal(done.action, "move");
  assert.equal(store.get("bookings/" + bookingId).preferredDate, "2099-01-05");
  assert.equal(store.get("availability/2099-01-04").slots["09_00"].available, true);
  assert.equal(store.get("availability/2099-01-05").slots["12_00"].bookedByBookingId, bookingId);
  assert.equal(store.get("bookings/" + bookingId).customerNotificationType, "booking_moved");
  assert.equal(store.get("bookings/" + bookingId).calendarSequence, 1);
  assert.ok(store.has("adminActivity/" + bookingId + "_action_1234567890123456"));
  const repeat = await service.executeAdminBookingChange(request, "move");
  assert.equal(repeat.alreadyApplied, true);
  const cancelRequest = { auth: request.auth, data: {
    bookingId, actionId: "cancel_1234567890123456", reason: "Customer has cancelled this inspection",
    refundDecision: "review_refund", reopenOldSlot: false
  } };
  const cancelled = await service.executeAdminBookingChange(cancelRequest, "cancel");
  assert.equal(cancelled.action, "cancel");
  assert.equal(store.get("bookings/" + bookingId).status, "cancelled");
  assert.equal(store.get("bookings/" + bookingId).paymentStatus, "paid", "refund is a separate explicit action");
  assert.equal(store.get("bookings/" + bookingId).cancellationRefundDecision, "review_refund");
  await assert.rejects(service.executeAdminBookingChange({
    ...cancelRequest, data: { ...cancelRequest.data, actionId: "cancel_another_123456789", refundDecision: "automatic" }
  }, "cancel"), /refund decision/);
  const editRequest = { auth: request.auth, data: {
    bookingId,
    actionId: "edit_1234567890123456",
    details: {
      customerName: "Updated Customer",
      email: "updated@example.com",
      phone: "0412345678",
      notes: "Corrected from the admin console."
    }
  } };
  const edited = await service.updateAdminBookingDetails(editRequest);
  assert.equal(edited.action, "details_edit");
  assert.equal(store.get("bookings/" + bookingId).customerName, "Updated Customer");
  assert.equal(store.get("bookings/" + bookingId).email, "updated@example.com");
  assert.equal(store.get("bookings/" + bookingId).paymentStatus, "paid", "detail edits cannot alter payments");
  assert.ok(store.has("adminActivity/" + bookingId + "_edit_1234567890123456"));
  await assert.rejects(service.updateAdminBookingDetails({
    auth: request.auth,
    data: { bookingId, actionId: "edit_unsafe_123456789", details: { paymentStatus: "refunded" } }
  }), /not editable/);
});
