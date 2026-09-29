import { app, db } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, getDocs, query, collection, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const auth = getAuth(app), $ = (id) => document.querySelector(id);
const refundBooking = httpsCallable(getFunctions(app, "us-central1"), "adminRefundBooking", { timeout: 90000 });
const money = (cents) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(cents || 0) / 100);
let authorised = false, bookingId = "", booking = null, selection = 0, working = false;
const remaining = () => Math.max(0, Number(booking?.stripeAmountTotal || 0) -
  Number(booking?.stripeAmountRefunded || 0) - Number(booking?.stripeAmountRefundPending || 0));
function message(text, type = "") {
  const node = $("#admin-refund-message");
  if (node) { node.textContent = text; node.dataset.type = type; }
}
function updateAmount() {
  const input = $("#admin-refund-amount"); if (!input) return;
  input.readOnly = $("#admin-refund-type")?.value === "full";
  input.value = input.readOnly ? (remaining() / 100).toFixed(2) : "";
}
function display() {
  const host = $("#refund-management-host"); if (!host) return;
  host.replaceChildren();
  if (!authorised || !booking) { host.textContent = "Choose a paid booking to review its refund options."; return; }
  const heading = document.createElement("h3");
  heading.textContent = (booking.customerName || "Customer") + " · " + bookingId;
  host.appendChild(heading);
  const summary = document.createElement("p");
  summary.className = "muted-help";
  summary.textContent = "Collected: " + money(booking.stripeAmountTotal) +
    " · Refunded: " + money(booking.stripeAmountRefunded) +
    " · Pending: " + money(booking.stripeAmountRefundPending) +
    " · Estimated remaining: " + money(remaining()) +
    " · State: " + (booking.refundStatus || "Not requested");
  host.appendChild(summary);
  if (booking.paymentStatus !== "paid" || !booking.stripePaymentIntentId) {
    const p = document.createElement("p");
    p.textContent = "Only completed Stripe payments can be refunded here; agency invoices and free checkouts are excluded.";
    host.appendChild(p); return;
  }
  if (booking.refundPendingActionId || remaining() < 1) {
    const p = document.createElement("p"); p.className = "booking-readonly-note";
    p.textContent = booking.refundPendingActionId
      ? "An earlier refund needs reconciliation. Review it in Stripe before attempting another."
      : "No refundable balance recorded. Refresh to check for updates.";
    host.appendChild(p); return;
  }
  const form = document.createElement("form");
  form.id = "admin-refund-form"; form.className = "admin-form";
  form.innerHTML = [
    '<label>Refund type<select id="admin-refund-type" required><option value="full">Full remaining amount</option><option value="partial">Partial amount</option></select></label>',
    '<label>Amount in AUD<input id="admin-refund-amount" inputmode="decimal" type="text" required /></label>',
    '<label>Reason<textarea id="admin-refund-reason" required minlength="8" maxlength="300"></textarea></label>',
    '<button class="btn danger-btn" type="submit">Confirm refund with Stripe</button>',
    '<p id="admin-refund-message" class="form-note" role="status" aria-live="polite"></p>'
  ].join("");
  host.appendChild(form);
  $("#admin-refund-type").addEventListener("change", updateAmount);
  form.addEventListener("submit", submitRefund);
  updateAmount();
}
async function selectBooking(id) {
  if (!authorised || !id) return;
  const current = ++selection;
  try {
    const snap = await getDoc(doc(db, "bookings", id));
    if (!authorised || current !== selection) return;
    bookingId = id; booking = snap.exists() ? snap.data() : null;
    display();
  } catch (error) {
    console.error("Could not load refund booking", error);
    const host = $("#refund-management-host");
    if (host) host.textContent = "Could not load booking. Refresh and try again.";
  }
}
async function loadQueue() {
  if (!authorised) return;
  const panel = $("#refund-queue"); if (!panel) return;
  panel.textContent = "Loading recent paid bookings…";
  try {
    const snap = await getDocs(query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(150)));
    if (!authorised) return;
    panel.replaceChildren();
    const paid = snap.docs.filter((entry) => entry.data()?.paymentStatus === "paid" && entry.data()?.stripePaymentIntentId);
    if (!paid.length) panel.textContent = "No paid bookings in the latest 150 records.";
    paid.forEach((entry) => {
      const data = entry.data(), button = document.createElement("button");
      button.type = "button"; button.className = "booking-row";
      button.textContent = (data.customerName || entry.id) + " · " + (data.preferredDate || "No date") +
        " · " + money(data.stripeAmountTotal) + " · " + (data.refundStatus || "Not refunded");
      button.addEventListener("click", () => selectBooking(entry.id));
      panel.appendChild(button);
    });
  } catch (error) { console.error("Could not load paid bookings", error); panel.textContent = "Could not load payments."; }
}
function cents(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return NaN;
  const parts = value.split(".");
  return Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"));
}
async function submitRefund(event) {
  event.preventDefault();
  if (!authorised || working || !booking || !bookingId) return;
  const amount = cents($("#admin-refund-amount").value.trim());
  const reason = $("#admin-refund-reason").value.trim();
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining() ||
    reason.length < 8 || reason.length > 300) return message("Enter a valid amount and an 8–300 character reason.", "error");
  const override = booking.status === "cancelled" && booking.cancellationRefundDecision === "no_refund"
    ? "This changes your previous cancellation decision. " : "";
  if (!window.confirm(override + "Issue a " + money(amount) + " refund to the original payment method for " +
    (booking.customerName || bookingId) + "?")) return;
  const button = event.submitter || $("#admin-refund-form button[type=submit]");
  button.disabled = true; working = true; message("Submitting to Stripe…");
  try {
    const result = await refundBooking({ bookingId, actionId: crypto.randomUUID(), amountCents: amount, reason });
    message("Stripe refund " + (result.data?.stripeRefundStatus || "submitted") + ". Review its final status in Stripe.", "success");
    await selectBooking(bookingId); await loadQueue(); $("#reload-bookings")?.click();
  } catch (error) {
    console.error("Refund action requires review", error);
    message("Refund result may be uncertain. Check Stripe before sending another request.", "error");
  } finally { working = false; button.disabled = false; }
}
window.addEventListener("irongate:booking-selected", (event) => {
  if (event.detail?.bookingId) selectBooking(event.detail.bookingId);
});
window.addEventListener("irongate:admin-tab", (event) => {
  if (event.detail?.tab === "payments" && authorised) { loadQueue(); if (bookingId) selectBooking(bookingId); }
});
onAuthStateChanged(auth, (user) => {
  authorised = Boolean(user && user.email?.trim().toLowerCase() === ADMIN_EMAIL);
  if (!authorised) { bookingId = ""; booking = null; ++selection; display(); $("#refund-queue")?.replaceChildren(); }
  else loadQueue();
});
