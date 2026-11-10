"use strict";
const { randomBytes } = require("node:crypto");
const { assertBookableDate, comparableSlotId, reserveSelectedSlot, expireCheckoutSession } = require("./direct-booking");

const SITE = "https://irongatepool.com.au/reinspection/";
const FEE_CENTS = 8900;
const OPEN = new Set(["reinspection_invited", "payment_expired"]);
const CONFIRMED = new Set(["confirmed", "completed", "certificate_issued"]);
const SETTLED = new Set(["paid", "agency_invoice", "no_payment_required"]);
const SERVICE = "Pool Safety Reinspection";

function fail(message, code = "failed-precondition") {
  throw Object.assign(new Error(message), { code });
}

function hasEnded(booking, now) {
  const end = Date.parse(`${booking.preferredDate}T${booking.preferredTimeEnd || "23:59"}:00+10:00`);
  return Number.isFinite(end) && end <= now;
}

function nextVisitNumber(last, now) {
  if (!last) return 1;
  if ([last.status, last.inspectionStatus].includes("certificate_issued")) fail("A certificate has already been issued for this inspection.");
  if (last.status === "cancelled" || last.inspectionStatus === "cancelled") return last.reinspectionNumber;
  if (!CONFIRMED.has(last.status) || (last.status === "confirmed" && !hasEnded(last, now))) {
    fail("The previous reinspection must take place before another link can be issued.");
  }
  return last.reinspectionNumber + 1;
}

function feeFor(booking, number) {
  return number === 1 || Number(booking.priceCents ?? booking.stripeAmountSubtotal ?? 14900) === 14900 ? 0 : FEE_CENTS;
}

function bookingLink(id, secret) {
  return SITE + "#" + id + "." + secret;
}

async function issueLink({ db, admin, bookingId, now = Date.now() }) {
  if (typeof bookingId !== "string" || !/^[A-Za-z0-9_-]{8,120}$/.test(bookingId)) fail("Invalid booking reference.", "invalid-argument");
  const bookings = db.collection("bookings");
  const parentRef = bookings.doc(bookingId);
  const newRef = bookings.doc(randomBytes(24).toString("hex"));
  const secret = randomBytes(24).toString("hex");
  return db.runTransaction(async (tx) => {
    const parent = (await tx.get(parentRef)).data();
    if (!parent || parent.source === "reinspection_link" || !SETTLED.has(parent.paymentStatus) ||
        !CONFIRMED.has(parent.status) ||
        parent.status === "cancelled" || parent.inspectionStatus === "cancelled" ||
        [parent.status, parent.inspectionStatus].includes("certificate_issued") ||
        (!hasEnded(parent, now) && ![parent.status, parent.inspectionStatus].includes("completed"))) {
      fail("Choose a completed initial inspection that still requires a reinspection.");
    }
    const lastId = parent.latestReinspectionId;
    const last = lastId ? (await tx.get(bookings.doc(lastId))).data() : null;
    if (lastId && !last) fail("The previous reinspection record could not be found.");
    if (last && (OPEN.has(last.status) || last.status === "pending_payment" || last.status === "payment_processing")) {
      return { url: bookingLink(lastId, last.reinspectionSecret), priceCents: last.priceCents };
    }

    const reinspectionNumber = nextVisitNumber(last, now);
    const priceCents = feeFor(parent, reinspectionNumber);
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    tx.set(newRef, {
      originalBookingId: bookingId,
      reinspectionSecret: secret,
      reinspectionNumber,
      source: "reinspection_link",
      status: "reinspection_invited",
      paymentStatus: "not_started",
      serviceName: SERVICE,
      priceCents,
      priceDisplay: `$${priceCents / 100}`,
      currency: "aud",
      createdAt: timestamp,
      updatedAt: timestamp
    });
    tx.set(parentRef, { latestReinspectionId: newRef.id }, { merge: true });
    return { url: bookingLink(newRef.id, secret), priceCents };
  });
}

function linkRef(db, token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}\.[a-f0-9]{48}$/.test(token)) fail("This reinspection link is invalid.", "not-found");
  return db.collection("bookings").doc(token.split(".")[0]);
}

function requireLink(booking, token) {
  if (booking?.source !== "reinspection_link" || booking.reinspectionSecret !== token.split(".")[1]) {
    fail("This reinspection link is invalid.", "not-found");
  }
  return booking;
}

function publicState(booking) {
  return {
    status: booking.status,
    priceCents: booking.priceCents,
    date: booking.preferredDate || null,
    time: booking.preferredTimeLabel || null,
    checkoutUrl: booking.status === "pending_payment" ? booking.stripeCheckoutUrl || null : null
  };
}

async function getLink(db, token) {
  return publicState(requireLink((await linkRef(db, token).get()).data(), token));
}

const CONTACT_FIELDS = [
  "customerName", "email", "phone", "propertyAddress", "propertyPlaceId",
  "customerType", "bookingRole", "bookingRoleCode", "agencyName", "poolType",
  "poolOwnerName", "poolOwnerEmail", "poolOwnerPhone", "accessContactName",
  "accessContactPhone", "accessContactEmail", "accessMethod", "accessInstructions"
];

function confirmationSlots(slots, id, timestamp) {
  function confirm(slot) {
    return slot?.bookingId === id ? {
      ...slot, reserved: false, reservationStatus: "confirmed",
      paymentStatus: "no_payment_required", confirmedAt: timestamp
    } : slot;
  }
  if (Array.isArray(slots)) return slots.map(confirm);
  return Object.fromEntries(Object.entries(slots).map(([key, slot]) => [key, confirm(slot)]));
}

async function bookVisit({ db, admin, getStripe, token, date, slotId, expectedPriceCents }) {
  const ref = linkRef(db, token);
  const draft = requireLink((await ref.get()).data(), token);
  if (!OPEN.has(draft.status)) return publicState(draft);
  if (expectedPriceCents !== draft.priceCents || ![0, FEE_CENTS].includes(draft.priceCents)) {
    fail("The reinspection price has changed. Reload the page before continuing.");
  }
  assertBookableDate(date);
  if (typeof slotId !== "string" || !/^\d{2}_\d{2}$/.test(slotId)) fail("Choose an available time.", "invalid-argument");
  const parentRef = db.collection("bookings").doc(draft.originalBookingId);
  const parent = (await parentRef.get()).data();
  if (!parent || parent.latestReinspectionId !== ref.id || parent.status === "cancelled" ||
      parent.inspectionStatus === "cancelled" || [parent.status, parent.inspectionStatus].includes("certificate_issued")) {
    fail("This reinspection link is no longer available. Contact IronGate.");
  }
  const availabilityRef = db.collection("availability").doc(date);
  const paid = draft.priceCents > 0;
  const stripe = paid ? getStripe() : null;
  const expiresAt = Math.floor(Date.now() / 1000) + 31 * 60;
  const session = paid ? await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: ref.id,
    customer_email: parent.email || undefined,
    success_url: bookingLink(ref.id, draft.reinspectionSecret),
    cancel_url: bookingLink(ref.id, draft.reinspectionSecret),
    expires_at: expiresAt,
    line_items: [{
      quantity: 1,
      price_data: { currency: "aud", unit_amount: draft.priceCents, product_data: { name: SERVICE } }
    }],
    metadata: { bookingId: ref.id, source: "reinspection_link" },
    payment_intent_data: { metadata: { bookingId: ref.id, source: "reinspection_link" } }
  }) : null;
  try {
    return await db.runTransaction(async (tx) => {
      const current = requireLink((await tx.get(ref)).data(), token);
      const latestParent = (await tx.get(parentRef)).data();
      const day = (await tx.get(availabilityRef)).data();
      if (!OPEN.has(current.status) || current.priceCents !== draft.priceCents) fail("This link already has a booking. Reload to see its status.");
      if (latestParent?.latestReinspectionId !== ref.id || latestParent.status === "cancelled" ||
          latestParent.inspectionStatus === "cancelled" || [latestParent.status, latestParent.inspectionStatus].includes("certificate_issued")) {
        fail("This reinspection link is no longer available. Contact IronGate.");
      }
      const rawSlots = day?.slots;
      const slot = Array.isArray(rawSlots) ? rawSlots.find(item => comparableSlotId(item) === slotId) : rawSlots?.[slotId];
      if (!slot?.start || !slot?.end || slot.bufferSlot === true || slot.privateInvite === true) fail("That time is no longer available.");
      const timestamp = admin.firestore.Timestamp.now();
      const timeLabel = slot.label || `${slot.start} – ${slot.end}`;
      const selected = {
        preferredDate: date,
        preferredTimeSlot: slotId,
        preferredTimeStart: slot.start,
        preferredTimeEnd: slot.end,
        preferredTimeLabel: timeLabel,
        preferredTime: timeLabel
      };
      let slots = reserveSelectedSlot(rawSlots, slotId, ref.id, selected, timestamp);
      if (!paid) slots = confirmationSlots(slots, ref.id, timestamp);
      const booking = {
        ...Object.fromEntries(CONTACT_FIELDS.filter(key => latestParent[key] !== undefined).map(key => [key, latestParent[key]])),
        ...selected,
        inspectionReason: "Reinspection",
        status: paid ? "pending_payment" : "confirmed",
        paymentStatus: paid ? "checkout_created" : "no_payment_required",
        paymentMethod: paid ? "stripe_checkout" : "included_reinspection",
        stripeCheckoutSessionId: session?.id || null,
        stripeCheckoutUrl: session?.url || null,
        stripeAmountTotal: draft.priceCents,
        stripeCurrency: "aud",
        checkoutExpiresAt: paid ? admin.firestore.Timestamp.fromMillis(expiresAt * 1000) : null,
        availabilityLocked: true,
        availabilityLockStatus: paid ? "checkout_reserved" : "confirmed",
        availabilityReservationStatus: paid ? "pending_checkout" : "confirmed",
        availabilityLockDate: date,
        availabilityLockSlot: slotId,
        updatedAt: timestamp
      };
      // Replace the slot map so deleted synthetic buffers cannot survive a merge.
      tx.update(availabilityRef, { slots, updatedAt: timestamp, updatedBy: "reinspection_booking" });
      tx.update(ref, booking);
      return publicState({ ...current, ...booking });
    });
  } catch (error) {
    if (session) await expireCheckoutSession(stripe, session.id);
    throw error;
  }
}

module.exports = { issueLink, getLink, bookVisit };

