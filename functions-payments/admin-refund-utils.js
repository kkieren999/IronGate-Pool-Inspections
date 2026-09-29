"use strict";

const ACTIVE = new Set(["succeeded", "pending", "requires_action"]);
function summariseRefunds(totalCents, refunds = []) {
  const total = Number(totalCents);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid payment total.");
  let succeeded = 0, pending = 0;
  const seen = new Set();
  for (const refund of refunds) {
    if (!refund || seen.has(refund.id)) continue;
    seen.add(refund.id);
    const amount = Number(refund.amount);
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Invalid Stripe refund amount.");
    if (refund.status === "succeeded") succeeded += amount;
    else if (ACTIVE.has(refund.status)) pending += amount;
  }
  const remaining = Math.max(0, total - succeeded - pending);
  const status = pending > 0 ? "refund_pending" :
    succeeded === 0 ? "not_refunded" :
    succeeded >= total ? "refunded" : "partially_refunded";
  return { total, succeeded, pending, remaining, status };
}
function validateRefundRequest(amount, reason) {
  if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("Refund must be a positive whole number of cents.");
  if (typeof reason !== "string" || reason.trim().length < 8 || reason.trim().length > 300) {
    throw new Error("Provide an 8-300 character refund reason.");
  }
  return reason.trim();
}
module.exports = { summariseRefunds, validateRefundRequest };
