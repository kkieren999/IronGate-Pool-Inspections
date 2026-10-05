import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const paymentSource = readFileSync(new URL("../functions-payments/index.js", import.meta.url), "utf8");
function getWebhookFns(db) {
  const first = paymentSource.indexOf("function normalisePromotionCode(value) {");
  const last = paymentSource.indexOf("\nexports.stripeWebhook = onRequest(", first);
  assert.ok(first > 0 && last > first);
  const code = paymentSource.slice(first, last);
  const admin = { firestore: { Timestamp: { now: () => "NOW" },
    FieldValue: { serverTimestamp: () => "NOW" } } };
  const context = {
    admin, db, CURRENCY: "aud", INSPECTION_PRICE_CENTS: 14900, INVOICE_PROMO_CODE: "INVOICE100", logger: { warn() {}, info() {} },
    isCompletedCheckoutSession: (s) => ["paid","no_payment_required"].includes(s.payment_status),
    comparableSlotId: (slot) => slot.id || slot.start?.replace(":", "_"),
    slotBelongsToBooking: (slot, id) => (slot.bookedByBookingId || slot.bookingId) === id,
    releasedSlot: (slot) => slot.bookingCreatedBuffer === true ? null :
      { ...slot, bookingId: null, bookedByBookingId: null, booked: false, available: true },
    confirmAvailabilityReservation: async () => { db.confirmCount += 1; }
  };
  return runInNewContext(code + "\n({ markCheckoutSessionPaid, markInvoicePaymentPaid, markCheckoutSessionExpired, isInvoicePaymentSession });", context);
}
function fakeDb(seed) {
  const store = new Map(Object.entries(seed));
  const db = {
    store, confirmCount: 0,
    collection(collectionName) {
      return { doc(id) { return { path: collectionName + "/" + id }; } };
    },
    async runTransaction(fn) {
      const writes = new Map();
      const tx = {
        async get(ref) {
          const d = store.get(ref.path);
          return { exists: d !== undefined, data() { return structuredClone(d); } };
        },
        set(ref, patch) {
          writes.set(ref.path, { ...(writes.get(ref.path) || store.get(ref.path) || {}), ...patch });
        }
      };
      const result = await fn(tx);
      for (const [key, value] of writes) store.set(key, value);
      return result;
    }
  };
  return db;
}
const id = "booking_webhook_12345";
const sid = "cs_test_12345";
const session = { id: sid, client_reference_id: id, payment_status: "paid",
  amount_total: 14900, amount_subtotal: 14900,
  payment_intent: "pi_test123", currency: "aud", metadata: { bookingId: id } };

test("expired webhook cannot undo an already-paid or cancelled booking", async () => {
  for (const status of ["confirmed", "cancelled"]) {
    const data = { status, paymentStatus: "paid", stripeCheckoutSessionId: sid,
      preferredDate: "2099-05-02", preferredTimeSlot: "09_00" };
    const db = fakeDb({ ["bookings/" + id]: data,
      "availability/2099-05-02": { slots: { "09_00": { id: "09_00", booked: true, bookingId: id } } } });
    const handlers = getWebhookFns(db);
    await handlers.markCheckoutSessionExpired(session);
    assert.equal(db.store.get("bookings/" + id).status, status);
    assert.equal(db.store.get("availability/2099-05-02").slots["09_00"].booked, true);
  }
});
test("expiry atomically releases only the selected booking and deletes its synthetic buffer", async () => {
  const db = fakeDb({
    ["bookings/" + id]: { status: "pending_payment", paymentStatus: "checkout_created",
      stripeCheckoutSessionId: sid, preferredDate: "2099-05-02", preferredTimeSlot: "09_00" },
    "availability/2099-05-02": { slots: {
      "09_00": { id: "09_00", bookingId: id, booked: true },
      "10_00": { id: "10_00", bookingId: id, bufferForSlot: "09_00", bookingCreatedBuffer: true },
      "11_00": { id: "11_00", bookingId: "other", booked: true }
    } }
  });
  await getWebhookFns(db).markCheckoutSessionExpired(session);
  assert.equal(db.store.get("bookings/" + id).status, "payment_expired");
  const slots = db.store.get("availability/2099-05-02").slots;
  assert.equal(slots["09_00"].available, true);
  assert.equal(slots["10_00"], undefined);
  assert.equal(slots["11_00"].bookingId, "other");
});
test("delayed unpaid or mismatched Checkout events cannot replace an existing paid booking", async () => {
  const db = fakeDb({ ["bookings/" + id]: { status: "confirmed", paymentStatus: "paid",
    stripeCheckoutSessionId: sid, preferredDate: "2099-05-02", preferredTimeSlot: "09_00" } });
  await getWebhookFns(db).markCheckoutSessionPaid({ ...session, payment_status: "unpaid" });
  assert.equal(db.store.get("bookings/" + id).paymentStatus, "paid");
  await getWebhookFns(db).markCheckoutSessionPaid({ ...session, id: "cs_other" });
  assert.equal(db.confirmCount, 0);
  const absent = fakeDb({});
  await getWebhookFns(absent).markCheckoutSessionPaid(session);
  assert.equal(absent.store.size, 0, "Webhook may not manufacture an orphan booking");
});

test("paid checkout without its held slot is flagged, not silently confirmed", async () => {
  const db = fakeDb({
    ["bookings/" + id]: { status: "pending_payment", paymentStatus: "checkout_created",
      stripeCheckoutSessionId: sid, preferredDate: "2099-05-02", preferredTimeSlot: "09_00" },
    "availability/2099-05-02": { slots: {
      "09_00": { id: "09_00", bookingId: "another_booking", booked: true }
    } }
  });
  const handlers = getWebhookFns(db);
  await handlers.markCheckoutSessionPaid(session);
  const booking = db.store.get("bookings/" + id);
  assert.equal(booking.status, "payment_exception");
  assert.equal(booking.paymentStatus, "paid", "money still needs accounting");
  assert.equal(booking.availabilityLockStatus, "conflict");
  assert.match(booking.availabilityLockError, /original time is no longer held/);
  assert.equal(db.confirmCount, 0, "must never lock another customer's slot");
});


test("INVOICE100 no-cost checkout is confirmed but recorded as invoice-required with zero Stripe cash received", async () => {
  const db = fakeDb({
    ["bookings/" + id]: { status: "pending_payment", paymentStatus: "checkout_created",
      stripeCheckoutSessionId: sid, preferredDate: "2099-05-02", preferredTimeSlot: "09_00", priceCents: 14900 },
    "availability/2099-05-02": { slots: {
      "09_00": { id: "09_00", bookingId: id, booked: true }
    } }
  });
  const invoiceSession = {
    ...session,
    payment_status: "no_payment_required",
    amount_total: 0,
    amount_subtotal: 14900,
    total_details: { amount_discount: 14900 },
    discounts: [{ promotion_code: { id: "promo_invoice", code: "INVOICE100" } }],
    payment_intent: null
  };
  await getWebhookFns(db).markCheckoutSessionPaid(invoiceSession);
  const booking = db.store.get("bookings/" + id);
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.paymentStatus, "paid", "existing confirmed-booking compatibility is preserved");
  assert.equal(booking.stripePromotionCode, "INVOICE100");
  assert.equal(booking.invoiceRequired, true);
  assert.equal(booking.billingMethod, "invoice");
  assert.equal(booking.billingStatus, "invoice_required");
  assert.equal(booking.invoiceAmountCents, 14900);
  assert.equal(booking.stripeCashReceivedCents, 0);
  assert.equal(db.confirmCount, 1);
});

test("normal paid checkout remains Stripe-paid and is not marked invoice-required", async () => {
  const db = fakeDb({
    ["bookings/" + id]: { status: "pending_payment", paymentStatus: "checkout_created",
      stripeCheckoutSessionId: sid, preferredDate: "2099-05-02", preferredTimeSlot: "09_00", priceCents: 14900 },
    "availability/2099-05-02": { slots: {
      "09_00": { id: "09_00", bookingId: id, booked: true }
    } }
  });
  await getWebhookFns(db).markCheckoutSessionPaid(session);
  const booking = db.store.get("bookings/" + id);
  assert.equal(booking.invoiceRequired, false);
  assert.equal(booking.billingMethod, "stripe");
  assert.equal(booking.billingStatus, "paid_stripe");
  assert.equal(booking.stripeCashReceivedCents, 14900);
});


test("Stripe invoice payment settles the INVOICE100 invoice without changing booking availability", async () => {
  const paymentLinkId = "plink_invoice_123";
  const invoiceSession = {
    id: "cs_invoice_pay_123",
    client_reference_id: id,
    payment_status: "paid",
    amount_total: 14900,
    currency: "aud",
    payment_intent: "pi_invoice_pay_123",
    payment_link: paymentLinkId,
    metadata: {
      bookingId: id,
      invoiceNumber: "IG-2099-ABC12345",
      paymentPurpose: "invoice_payment"
    }
  };
  const db = fakeDb({
    ["bookings/" + id]: {
      status: "confirmed",
      paymentStatus: "paid",
      stripePromotionCode: "INVOICE100",
      invoiceRequired: true,
      invoiceNumber: "IG-2099-ABC12345",
      invoiceStatus: "issued",
      invoiceAmountCents: 14900,
      stripeCashReceivedCents: 0,
      preferredDate: "2099-05-02",
      preferredTimeSlot: "09_00"
    },
    "availability/2099-05-02": { slots: {
      "09_00": { id: "09_00", bookingId: id, booked: true }
    } }
  });
  const deactivated = [];
  const stripe = { paymentLinks: { async update(linkId, patch) { deactivated.push([linkId, patch]); } } };
  const handlers = getWebhookFns(db);
  assert.equal(handlers.isInvoicePaymentSession(invoiceSession), true);
  await handlers.markInvoicePaymentPaid(invoiceSession, stripe);
  const booking = db.store.get("bookings/" + id);
  assert.equal(booking.status, "confirmed");
  assert.equal(booking.paymentStatus, "paid");
  assert.equal(booking.invoiceStatus, "paid");
  assert.equal(booking.billingStatus, "invoice_paid_stripe");
  assert.equal(booking.billingMethod, "invoice_stripe");
  assert.equal(booking.stripeCashReceivedCents, 14900);
  assert.equal(booking.stripeInvoicePaymentIntentId, "pi_invoice_pay_123");
  assert.equal(booking.stripeInvoicePaymentLinkId, paymentLinkId);
  assert.equal(db.confirmCount, 0, "invoice settlement must not re-run booking slot confirmation");
  assert.deepEqual(deactivated, [[paymentLinkId, { active: false }]]);
  assert.equal(db.store.get("availability/2099-05-02").slots["09_00"].booked, true);
});

test("Stripe invoice payment with the wrong amount is not marked paid", async () => {
  const db = fakeDb({
    ["bookings/" + id]: {
      status: "confirmed",
      paymentStatus: "paid",
      stripePromotionCode: "INVOICE100",
      invoiceRequired: true,
      invoiceNumber: "IG-2099-ABC12345",
      invoiceStatus: "issued",
      invoiceAmountCents: 14900
    }
  });
  const handlers = getWebhookFns(db);
  await handlers.markInvoicePaymentPaid({
    id: "cs_invoice_wrong_amount",
    payment_status: "paid",
    amount_total: 9900,
    currency: "aud",
    metadata: { bookingId: id, invoiceNumber: "IG-2099-ABC12345", paymentPurpose: "invoice_payment" }
  }, { paymentLinks: { async update() {} } });
  const booking = db.store.get("bookings/" + id);
  assert.equal(booking.invoiceStatus, "issued");
  assert.equal(booking.invoicePaymentStatus, "amount_mismatch");
  assert.equal(booking.billingStatus, "invoice_payment_exception");
});
