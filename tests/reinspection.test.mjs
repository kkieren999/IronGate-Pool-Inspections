import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { runInNewContext } from "node:vm";

function load(name, require) {
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL("../functions-payments/" + name + ".js", import.meta.url), "utf8"), { module, require, Intl, Date });
  return module.exports;
}

const direct = load("direct-booking", () => ({}));
const reinspection = load("reinspection", name => name === "node:crypto" ? { randomBytes } : direct);

const parentId = "original-booking";
const date = "2099-05-02";
const slotId = "09_00";
const now = Date.parse("2026-11-10T00:00:00Z");
const timestamp = 42;
const admin = { firestore: {
  FieldValue: { serverTimestamp: () => timestamp },
  Timestamp: { now: () => timestamp, fromMillis: value => value }
} };

function setup(priceCents = 22900) {
  const records = new Map([
    ["bookings/" + parentId, {
      status: "confirmed", paymentStatus: "paid", preferredDate: "2026-10-10",
      preferredTimeEnd: "10:00", priceCents, customerName: "Example Customer",
      email: "customer@example.com", propertyAddress: "Test property"
    }],
    ["availability/" + date, {
      slots: { [slotId]: { id: slotId, start: "09:00", end: "10:00", available: true } }
    }]
  ]);
  let queue = Promise.resolve();
  const db = {
    collection(name) {
      return { doc(id) {
        const path = name + "/" + id;
        return { id, path, async get() { return { data: () => records.get(path) }; } };
      } };
    },
    runTransaction(fn) {
      const work = queue.then(async () => {
        const writes = new Map();
        const tx = {
          get: ref => ref.get(),
          set(ref, data, options) {
            writes.set(ref.path, options?.merge ? { ...records.get(ref.path), ...data } : data);
          },
          update(ref, data) {
            assert.ok(records.has(ref.path));
            writes.set(ref.path, { ...records.get(ref.path), ...data });
          }
        };
        const result = await fn(tx);
        for (const [key, value] of writes) records.set(key, value);
        return result;
      });
      queue = work.catch(() => {});
      return work;
    }
  };
  const issue = () => reinspection.issueLink({ db, admin, bookingId: parentId, now });
  const book = (token, expectedPriceCents, getStripe = () => assert.fail("Unexpected Stripe call")) =>
    reinspection.bookVisit({ db, admin, token, date, slotId, expectedPriceCents, getStripe });
  return { db, records, issue, book };
}

test("first reinspection is free, reserves the shared slot and cannot be booked twice", async () => {
  const { db, records, issue, book } = setup();
  const [first, duplicate] = await Promise.all([issue(), issue()]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.priceCents, 0);
  const token = new URL(first.url).hash.slice(1);
  const id = token.split(".")[0];
  await assert.rejects(() => reinspection.getLink(db, id + "." + "0".repeat(48)), /invalid/);
  const status = await reinspection.getLink(db, token);
  assert.deepEqual({ ...status }, { status: "reinspection_invited", priceCents: 0, date: null, time: null, checkoutUrl: null });
  await assert.rejects(() => book(token, 8900), /price has changed/);
  const results = await Promise.allSettled([book(token, 0), book(token, 0)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const booking = records.get("bookings/" + id);
  assert.equal(booking.paymentStatus, "no_payment_required");
  assert.equal(booking.originalBookingId, parentId);
  assert.equal(booking.propertyAddress, "Test property");
  const slots = records.get("availability/" + date).slots;
  assert.equal(slots[slotId].bookingId, id);
  assert.equal(slots[slotId].propertyAddress, "");
  assert.equal(slots["10_00"].bufferForSlot, slotId);
  await assert.rejects(issue, /previous reinspection must take place/);
  assert.equal((await book(token, 0)).status, "confirmed");
});

test("later visits charge $89 for the current package and remain included for the legacy package", async () => {
  for (const [price, expected] of [[22900, 8900], [14900, 0]]) {
    const { records, issue } = setup(price);
    const first = await issue();
    const path = "bookings/" + new URL(first.url).hash.slice(1).split(".")[0];
    records.set(path, { ...records.get(path), status: "completed" });
    const second = await issue();
    assert.equal(second.priceCents, expected);
    assert.notEqual(first.url, second.url);
  }
});

test("paid checkout holds the slot, and a failed competing attempt expires its Stripe session", async () => {
  const { records, issue, book } = setup();
  const first = await issue();
  const previous = "bookings/" + new URL(first.url).hash.slice(1).split(".")[0];
  records.set(previous, { ...records.get(previous), status: "completed" });
  const second = await issue();
  const token = new URL(second.url).hash.slice(1);
  const id = token.split(".")[0];
  const created = [], expired = [];
  const getStripe = () => ({ checkout: { sessions: {
    async create(options) {
      created.push(options);
      return { id: "cs_" + created.length, url: "https://checkout.stripe.com/" + created.length };
    },
    async expire(id) { expired.push(id); }
  } } });
  const results = await Promise.allSettled([book(token, 8900, getStripe), book(token, 8900, getStripe)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(created[0].line_items[0].price_data.unit_amount, 8900);
  assert.equal(created[0].metadata.bookingId, id);
  assert.deepEqual(expired, ["cs_2"]);
  const child = records.get("bookings/" + id);
  assert.equal(child.paymentStatus, "checkout_created");
  assert.equal(child.stripeCheckoutSessionId, "cs_1");
  assert.equal(records.get("availability/" + date).slots[slotId].reservationStatus, "pending_checkout");
});

