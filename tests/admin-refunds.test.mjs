import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { summariseRefunds, validateRefundRequest } = require("../functions-payments/admin-refund-utils.js");
test("refund summary counts settled and pending amounts without duplication", () => {
  const result = summariseRefunds(14900, [
    { id: "one", amount: 5000, status: "succeeded" },
    { id: "two", amount: 2000, status: "pending" },
    { id: "one", amount: 5000, status: "succeeded" },
    { id: "three", amount: 1000, status: "failed" }
  ]);
  assert.deepEqual(result, {
    total: 14900, succeeded: 5000, pending: 2000, remaining: 7900, status: "refund_pending"
  });
  assert.equal(summariseRefunds(14900, [{ id: "full", amount: 14900, status: "succeeded" }]).status, "refunded");
  assert.equal(summariseRefunds(14900, [{ id: "partial", amount: 400, status: "succeeded" }]).status, "partially_refunded");
  assert.equal(summariseRefunds(14900, [{ id: "reversed", amount: 400, status: "canceled" }]).remaining, 14900);
  assert.throws(() => validateRefundRequest(0, "Customer requested refund"), /positive/);
  assert.throws(() => validateRefundRequest(100, "short"), /reason/);
  assert.equal(validateRefundRequest(100, " Customer requested refund "), "Customer requested refund");
});
test("refund callable requires server authorization and Stripe-side amount verification", () => {
  const service = readFileSync(new URL("../functions-payments/admin-refunds.js", import.meta.url), "utf8");
  const endpoint = readFileSync(new URL("../functions-payments/index.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../website/js/admin-refund-panel.js", import.meta.url), "utf8");
  assert.match(service, /await requireAdmin\(request\)/);
  assert.match(service, /db\.runTransaction/);
  assert.match(service, /paymentIntents\.retrieve/);
  assert.match(service, /listPaymentRefunds\(stripe, intentId\)/);
  assert.match(service, /amount > totals\.remaining/);
  assert.match(service, /idempotencyKey/);
  assert.match(service, /refundPendingActionId/);
  assert.match(service, /markAmbiguous/);
  assert.match(endpoint, /exports\.adminRefundBooking = onCall/);
  assert.match(endpoint, /refund\.created.*refund\.updated.*refund\.failed/);
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /adminRefundBooking/);
  assert.doesNotMatch(ui, /stripe\.refunds\.create/);
});
