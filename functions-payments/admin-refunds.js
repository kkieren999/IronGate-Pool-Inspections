"use strict";
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const { HttpsError } = require("firebase-functions/v2/https");
const { requireAdmin } = require("./admin-booking-service");
const { summariseRefunds, validateRefundRequest } = require("./admin-refund-utils");

const db = admin.firestore();
const PROJECT_CURRENCY = "aud";
const VALID_ID = /^[a-zA-Z0-9_-]{16,100}$/;
const ACTIVE_REFUND = new Set(["succeeded", "pending", "requires_action"]);
function validId(value, label) {
  if (typeof value !== "string" || !VALID_ID.test(value)) {
    throw new HttpsError("invalid-argument", "Invalid " + label + ".");
  }
  return value;
}
function piId(value) { return typeof value === "string" ? value : value?.id || ""; }
function refundActionRef(bookingId, actionId) {
  return db.collection("refundOperations").doc(bookingId + "_" + actionId);
}
async function listPaymentRefunds(stripe, paymentIntentId) {
  const result = [], seen = new Set();
  let startingAfter = null;
  for (let page = 0; page < 30; page += 1) {
    const params = { payment_intent: paymentIntentId, limit: 100 };
    if (startingAfter) params.starting_after = startingAfter;
    const response = await stripe.refunds.list(params);
    const batch = response.data || [];
    for (const entry of batch) {
      if (entry?.id && !seen.has(entry.id)) { seen.add(entry.id); result.push(entry); }
    }
    if (!response.has_more) return result;
    if (!batch.length) throw new Error("Stripe refund pagination stopped unexpectedly.");
    startingAfter = batch[batch.length - 1].id;
  }
  throw new Error("Stripe refund list too large; manual finance reconciliation required.");
}
function presentResult(refund, summary) {
  return { stripeRefundId: refund?.id || null, stripeRefundStatus: refund?.status || null,
    refundStatus: summary.status, refundedCents: summary.succeeded,
    pendingCents: summary.pending, remainingCents: summary.remaining };
}
async function reconcilePaymentRefunds(stripe, bookingId, paymentIntentId, latest = null) {
  const bookingRef = db.collection("bookings").doc(bookingId);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists || bookingSnap.data()?.stripePaymentIntentId !== paymentIntentId) return null;
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  if (intent.currency !== PROJECT_CURRENCY || intent.status !== "succeeded") {
    throw new Error("Stripe payment is not a completed AUD payment.");
  }
  const refunds = await listPaymentRefunds(stripe, paymentIntentId);
  if (latest && !refunds.some((item) => item.id === latest.id)) refunds.push(latest);
  const summary = summariseRefunds(intent.amount_received, refunds);
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  // Stripe list reflects current state; do not let an older webhook downgrade a settled refund.
  const matchedRefund = latest ? (refunds.find((item) => item.id === latest.id) || latest) :
    (refunds.find((item) => item.metadata?.actionId) || null);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(bookingRef);
    if (!snapshot.exists || snapshot.data()?.stripePaymentIntentId !== paymentIntentId) return;
    const current = snapshot.data() || {};
    const pendingId = current.refundPendingActionId || "";
    const matching = pendingId ? refunds.find((item) => item.metadata?.actionId === pendingId) : null;
    const holdLock = (current.refundStatus === "needs_review" || current.refundStatus === "processing") && !matching;
    const keepLock = holdLock || (matching && ACTIVE_REFUND.has(matching.status) && matching.status !== "succeeded");
    const patch = {
      stripeAmountRefunded: summary.succeeded,
      stripeAmountRefundPending: summary.pending,
      refundStatus: keepLock ? (holdLock ? current.refundStatus : "refund_pending") : summary.status,
      refundPendingActionId: keepLock ? pendingId : null,
      refundReconciledAt: stamp, updatedAt: stamp
    };
    if (matchedRefund?.id) {
      patch.lastStripeRefundId = matchedRefund.id;
      patch.lastStripeRefundStatus = matchedRefund.status || "pending";
      patch.lastRefundAmountCents = Number(matchedRefund.amount || 0);
      if (matchedRefund.status === "succeeded" &&
          current.lastRefundNotifiedId !== matchedRefund.id) {
        patch.lastRefundNotifiedId = matchedRefund.id;
        patch.customerNotificationType = "refund_updated";
        patch.customerNotificationId = "refund_" + matchedRefund.id + "_succeeded";
        patch.customerNotificationError = null;
      }
    }
    const actionId = matchedRefund?.metadata?.actionId;
    const actionRef = actionId && VALID_ID.test(actionId) ? refundActionRef(bookingId, actionId) : null;
    const actionSnap = actionRef ? await tx.get(actionRef) : null;
    tx.update(bookingRef, patch);
    if (actionRef && actionSnap?.exists && actionSnap.data()?.paymentIntentId === paymentIntentId &&
        actionSnap.data()?.bookingId === bookingId) {
      tx.update(actionRef, {
        stripeRefundId: matchedRefund.id, status: matchedRefund.status || "pending",
        lastCheckedAt: stamp,
        ...(matchedRefund.status === "succeeded" ? { completedAt: stamp } : {}),
        ...(matchedRefund.status === "failed" ? { failureReason: matchedRefund.failure_reason || "Refund failed" } : {})
      });
    }
  });
  return presentResult(matchedRefund, summary);
}
async function rejectBeforeStripe(bookingId, actionId, reason) {
  const bookingRef = db.collection("bookings").doc(bookingId), opRef = refundActionRef(bookingId, actionId);
  await db.runTransaction(async (tx) => {
    const [b, op] = await Promise.all([tx.get(bookingRef), tx.get(opRef)]);
    if (!b.exists || !op.exists || b.data()?.refundPendingActionId !== actionId) return;
    tx.update(bookingRef, { refundPendingActionId: null, refundStatus: "needs_review",
      refundError: reason, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(opRef, { status: "rejected", error: reason, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  });
}
async function markAmbiguous(bookingId, actionId, error) {
  const bookingRef = db.collection("bookings").doc(bookingId), opRef = refundActionRef(bookingId, actionId);
  await db.runTransaction(async (tx) => {
    const [b, op] = await Promise.all([tx.get(bookingRef), tx.get(opRef)]);
    if (!b.exists || !op.exists || b.data()?.refundPendingActionId !== actionId) return;
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    tx.update(bookingRef, { refundStatus: "needs_review",
      refundError: "Refund result uncertain; verify in Stripe before any new request.",
      updatedAt: stamp });
    tx.update(opRef, { status: "needs_review", error: String(error.message || error).slice(0, 160), updatedAt: stamp });
  });
}
async function adminRefundBooking(request, stripe) {
  const actor = await requireAdmin(request);
  const data = request.data || {};
  const bookingId = validId(data.bookingId, "booking ID");
  const actionId = validId(data.actionId, "refund action ID");
  const amount = data.amountCents;
  let reason;
  try { reason = validateRefundRequest(amount, data.reason); }
  catch (error) { throw new HttpsError("invalid-argument", error.message); }
  const bookingRef = db.collection("bookings").doc(bookingId), opRef = refundActionRef(bookingId, actionId);
  const stage = await db.runTransaction(async (tx) => {
    const [b, op] = await Promise.all([tx.get(bookingRef), tx.get(opRef)]);
    if (!b.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = b.data() || {};
    if (booking.paymentStatus !== "paid" ||
        typeof booking.stripePaymentIntentId !== "string" ||
        !/^pi_[a-zA-Z0-9]+$/.test(booking.stripePaymentIntentId)) {
      throw new HttpsError("failed-precondition", "A completed Stripe payment is required. Agency invoices and free checkouts cannot be refunded here.");
    }
    if (op.exists) {
      const previous = op.data() || {};
      if (previous.actorUid !== actor.uid || previous.bookingId !== bookingId ||
          previous.amountCents !== amount || previous.reason !== reason ||
          previous.paymentIntentId !== booking.stripePaymentIntentId) {
        throw new HttpsError("already-exists", "Refund action ID was used for different details.");
      }
      if (["succeeded", "pending", "requires_action"].includes(previous.status)) {
        return { previous, finished: true };
      }
      if (!["processing", "needs_review"].includes(previous.status)) {
        throw new HttpsError("failed-precondition", "Review this refund in Stripe before submitting another request.");
      }
      const age = Date.now() - (previous.createdAt?.toMillis?.() || 0);
      if (age < 0 || age > 23 * 60 * 60 * 1000) {
        throw new HttpsError("failed-precondition", "Refund retry window expired; reconcile manually in Stripe.");
      }
      return { previous, finished: false };
    }
    if (booking.refundPendingActionId) {
      throw new HttpsError("failed-precondition", "Another refund needs reconciliation before starting a new one.");
    }
    const stamp = admin.firestore.FieldValue.serverTimestamp();
    const record = { bookingId, actionId, actorUid: actor.uid, actorEmail: actor.email,
      amountCents: amount, reason, paymentIntentId: booking.stripePaymentIntentId,
      status: "processing", createdAt: stamp };
    tx.create(opRef, record);
    tx.update(bookingRef, { refundPendingActionId: actionId,
      refundStatus: "processing", refundError: null, updatedAt: stamp });
    tx.create(db.collection("adminActivity").doc(bookingId + "_" + actionId), {
      bookingId, actionId, action: "refund_requested", actorUid: actor.uid,
      actorEmail: actor.email, amountCents: amount, reason, createdAt: stamp
    });
    return { previous: record, finished: false };
  });
  if (stage.finished) return { bookingId, actionId, alreadyApplied: true,
    stripeRefundId: stage.previous.stripeRefundId || null, stripeRefundStatus: stage.previous.status };
  const intentId = stage.previous.paymentIntentId;
  let attempted = false;
  try {
    const intent = await stripe.paymentIntents.retrieve(intentId);
    if (intent.status !== "succeeded" || intent.currency !== PROJECT_CURRENCY ||
        !Number.isSafeInteger(intent.amount_received) || intent.amount_received <= 0 ||
        (intent.metadata?.bookingId && intent.metadata.bookingId !== bookingId)) {
      await rejectBeforeStripe(bookingId, actionId, "PaymentIntent is not a matching captured AUD booking payment.");
      throw new HttpsError("failed-precondition", "Refund requires a matching, captured AUD Stripe payment.");
    }
    const refunds = await listPaymentRefunds(stripe, intentId);
    const existing = refunds.find((item) => item.metadata?.actionId === actionId &&
      item.metadata?.bookingId === bookingId);
    let refund = existing;
    if (!refund) {
      const totals = summariseRefunds(intent.amount_received, refunds);
      if (amount > totals.remaining) {
        await rejectBeforeStripe(bookingId, actionId, "Refund amount exceeds Stripe's remaining balance.");
        throw new HttpsError("failed-precondition", "Refund exceeds the remaining Stripe payment balance.");
      }
      attempted = true;
      refund = await stripe.refunds.create({
        payment_intent: intentId, amount,
        metadata: { bookingId, actionId, source: "irongate_admin", reason }
      }, { idempotencyKey: "irongate_admin_refund_" + bookingId + "_" + actionId });
    }
    const result = await reconcilePaymentRefunds(stripe, bookingId, intentId, refund);
    if (!result) throw new Error("Payment was refunded, but local booking could not be reconciled.");
    return { bookingId, actionId, alreadyApplied: Boolean(existing), ...result };
  } catch (error) {
    if (attempted || !(error instanceof HttpsError)) {
      await markAmbiguous(bookingId, actionId, error);
      logger.error("Stripe refund needs manual review", { bookingId, actionId, message: error.message });
      throw new HttpsError("unavailable", "Refund result is uncertain. Verify Stripe before retrying or creating another refund.");
    }
    throw error;
  }
}
async function reconcileRefundEvent(stripe, refund) {
  const intentId = piId(refund?.payment_intent);
  if (!intentId) { logger.warn("Refund event lacks PaymentIntent", { refundId: refund?.id || null }); return; }
  const matched = await db.collection("bookings").where("stripePaymentIntentId", "==", intentId).limit(2).get();
  if (matched.empty) { logger.warn("Refund is not linked to an IronGate booking", { refundId: refund.id }); return; }
  if (matched.size !== 1) throw new Error("Multiple bookings share one Stripe PaymentIntent; manual reconciliation required.");
  return reconcilePaymentRefunds(stripe, matched.docs[0].id, intentId, refund);
}
module.exports = { adminRefundBooking, reconcileRefundEvent, listPaymentRefunds, reconcilePaymentRefunds };
