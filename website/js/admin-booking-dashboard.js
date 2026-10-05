import { app, db } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

// This module only reads Firestore. All writes, payment and slot operations
// belong to authenticated backend functions, never browser-side field edits.
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
const reconcileBookingBilling = httpsCallable(functions, "adminReconcileBookingBilling");
const issueBookingInvoice = httpsCallable(functions, "adminIssueBookingInvoice");
const $ = (selector) => document.querySelector(selector);
const todayBrisbane = () => {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).reduce((map, part) => { map[part.type] = part.value; return map; }, {});
  return parts.year + "-" + parts.month + "-" + parts.day;
};
const text = (value) => value === null || value === undefined || value === "" ? "Not provided" : String(value);
let records = [];
let activeBookingId = "";
let authorized = false;
let requestSequence = 0;
const billingReconcileAttempted = new Set();
const INVOICE_PROMO_CODE = "INVOICE100";
const TERMINAL = new Set(["cancelled", "completed", "certificate_issued"]);

function value(id, content) {
  const node = $(id);
  if (node) node.textContent = content;
}
function bookingStatus(booking) {
  return text(booking.status || booking.inspectionStatus || booking.paymentStatus || "unknown");
}
function safeAmount(cents) {
  const n = Number(cents);
  return Number.isFinite(n) && n >= 0
    ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n / 100)
    : "Not provided";
}
function promoCode(booking = {}) {
  return String(booking.stripePromotionCode || "").trim().toUpperCase();
}
function isInvoiceBooking(booking = {}) {
  return booking.invoiceRequired === true || promoCode(booking) === INVOICE_PROMO_CODE;
}
function stripeCashReceived(booking = {}) {
  const direct = Number(booking.stripeCashReceivedCents);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const total = Number(booking.stripeAmountTotal);
  return booking.paymentStatus === "paid" && Number.isFinite(total) && total > 0 ? total : 0;
}
function isStripePaidBooking(booking = {}) {
  return !isInvoiceBooking(booking) && booking.paymentStatus === "paid" && stripeCashReceived(booking) > 0;
}
function billingLabel(booking = {}) {
  if (isInvoiceBooking(booking)) {
    if (booking.invoiceStatus === "issued") return "INVOICE ISSUED — " + INVOICE_PROMO_CODE;
    return "INVOICE REQUIRED — " + INVOICE_PROMO_CODE;
  }
  if (isStripePaidBooking(booking)) return "PAID — " + safeAmount(stripeCashReceived(booking)) + " RECEIVED";
  if (booking.noCostCheckout === true) return "NO-COST CHECKOUT";
  return String(booking.billingStatus || booking.paymentStatus || "Payment not recorded").replaceAll("_", " ").toUpperCase();
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function displayInvoiceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return text(value);
  const [year, month, day] = String(value).split("-").map(Number);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Brisbane"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
function invoiceHtml(record) {
  const b = record.data || {};
  const amount = Number(b.invoiceAmountCents || b.stripeAmountSubtotal || b.priceCents || 14900);
  const customer = b.agencyName || b.customerName || "Client";
  const invoiceNumber = b.invoiceNumber || "Pending";
  const issueDate = b.invoiceIssuedDate || "";
  const dueDate = b.invoiceDueDate || "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${escapeHtml(invoiceNumber)} | Iron Gate Pool Inspections</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#12263a;background:#eef4f8}.toolbar{position:sticky;top:0;display:flex;gap:10px;justify-content:center;padding:12px;background:#08294f}.toolbar button{border:0;border-radius:9px;padding:11px 16px;font-weight:800;cursor:pointer}.print{background:#fff;color:#08294f}.close{background:#dceaf3;color:#08294f}.invoice{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:17mm;box-shadow:0 8px 30px rgba(0,0,0,.12)}.top{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #0b3867;padding-bottom:20px}.brand h1{margin:0;color:#08294f;font-size:27px}.brand p{margin:6px 0;color:#607789}.title{text-align:right}.title h2{margin:0;font-size:34px;color:#0b3867}.title div{margin-top:6px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}.box h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#647789;margin:0 0 8px}.box p{margin:4px 0;line-height:1.45}.line{width:100%;border-collapse:collapse;margin:24px 0}.line th,.line td{padding:13px 10px;border-bottom:1px solid #dbe5eb;text-align:left}.line th:last-child,.line td:last-child{text-align:right}.total{display:flex;justify-content:flex-end}.totalbox{width:280px}.totalrow{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #dbe5eb}.due{font-size:20px;font-weight:900;color:#08294f}.bank{margin-top:32px;padding:18px;border-radius:12px;background:#f3f8fb}.bank h3{margin:0 0 10px;color:#08294f}.sample{margin-top:10px;padding:10px;border:1px solid #e0ad52;background:#fff8e7;color:#7a4d00;font-weight:700}.footer{margin-top:34px;padding-top:14px;border-top:1px solid #dbe5eb;color:#607789;font-size:12px}@media(max-width:800px){.invoice{width:auto;min-height:0;margin:0;padding:24px}.top,.grid{grid-template-columns:1fr;display:grid}.title{text-align:left}}@media print{body{background:#fff}.toolbar{display:none}.invoice{width:auto;min-height:0;margin:0;box-shadow:none;padding:0}.sample{border-color:#999}}
</style></head><body>
<div class="toolbar"><button class="print" onclick="window.print()">Print / Save PDF</button><button class="close" onclick="window.close()">Close</button></div>
<main class="invoice">
<section class="top"><div class="brand"><h1>Iron Gate Pool Inspections</h1><p>Pool Safety Inspection &amp; Certificate</p><p>irongatepool.com.au</p></div>
<div class="title"><h2>INVOICE</h2><div><strong>${escapeHtml(invoiceNumber)}</strong></div><div>Issued: ${escapeHtml(displayInvoiceDate(issueDate))}</div><div>Due: ${escapeHtml(displayInvoiceDate(dueDate))}</div></div></section>
<section class="grid"><div class="box"><h3>Bill to</h3><p><strong>${escapeHtml(customer)}</strong></p><p>${escapeHtml(b.customerName || "")}</p><p>${escapeHtml(b.email || "")}</p></div>
<div class="box"><h3>Inspection</h3><p><strong>${escapeHtml(b.propertyAddress || "")}</strong></p><p>${escapeHtml(b.preferredDateDisplay || b.preferredDate || "")}</p><p>Booking reference: ${escapeHtml(record.id)}</p></div></section>
<table class="line"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>Pool Safety Inspection &amp; Certificate</td><td>${escapeHtml(safeAmount(amount))}</td></tr></tbody></table>
<div class="total"><div class="totalbox"><div class="totalrow due"><span>Amount due</span><span>${escapeHtml(safeAmount(amount))}</span></div></div></div>
<section class="bank"><h3>Payment details</h3><p><strong>Account name:</strong> Iron Gate Pool Inspections</p><p><strong>BSB:</strong> 000-000</p><p><strong>Account number:</strong> 00000000</p><p><strong>Reference:</strong> ${escapeHtml(invoiceNumber)}</p><div class="sample">Sample banking details only — replace these details before sending invoices to clients.</div></section>
<p class="footer">This document is an Invoice, not a Tax Invoice. Payment received outside Stripe should be reconciled separately in your accounting records.</p>
</main></body></html>`;
}
function renderInvoiceWindow(win, record) {
  if (!win) return;
  try { win.opener = null; } catch (_) {}
  win.document.open();
  win.document.write(invoiceHtml(record));
  win.document.close();
}
async function createOrOpenInvoice(record) {
  const win = window.open("", "_blank", "width=920,height=1050");
  if (!win) {
    value("#bookings-message", "Your browser blocked the invoice window. Allow pop-ups for this site and try again.");
    return;
  }
  win.document.write("<p style='font:16px Arial;padding:24px'>Preparing invoice…</p>");
  try {
    if (!record.data.invoiceNumber) {
      const response = await issueBookingInvoice({ bookingId: record.id });
      Object.assign(record.data, response.data || {});
      record.data.invoiceStatus = record.data.invoiceStatus || "issued";
      record.data.billingStatus = record.data.billingStatus || "invoice_issued";
      renderOverview();
      renderList();
      if (activeBookingId === record.id) renderDetails();
    }
    renderInvoiceWindow(win, record);
  } catch (error) {
    console.error("Could not generate invoice", error);
    win.close();
    value("#bookings-message", error?.message || "Could not generate invoice.");
  }
}
function renderBillingActions(container, record) {
  const b = record.data || {};
  const box = document.createElement("div");
  box.className = "billing-admin-box";
  const badge = document.createElement("strong");
  badge.className = "billing-badge " + (isInvoiceBooking(b) ? "is-invoice" : isStripePaidBooking(b) ? "is-paid" : "");
  badge.textContent = billingLabel(b);
  box.appendChild(badge);

  if (isInvoiceBooking(b)) {
    const note = document.createElement("p");
    note.className = "muted-help";
    note.textContent = b.invoiceStatus === "issued"
      ? "Invoice " + (b.invoiceNumber || "") + " is ready to view or print."
      : "Stripe collected $0.00 using INVOICE100. Generate an invoice for the original inspection amount.";
    box.appendChild(note);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    button.textContent = b.invoiceStatus === "issued" ? "View / Print Invoice" : "Generate Invoice";
    button.addEventListener("click", () => createOrOpenInvoice(record));
    box.appendChild(button);
  }
  container.appendChild(box);
}
async function maybeReconcileLegacyBilling(record) {
  const b = record?.data || {};
  if (!record?.id || billingReconcileAttempted.has(record.id) || b.stripePromotionCode ||
      !b.stripeCheckoutSessionId || b.discountApplied !== true || b.noCostCheckout !== true) return;
  billingReconcileAttempted.add(record.id);
  try {
    const response = await reconcileBookingBilling({ bookingId: record.id });
    Object.assign(record.data, response.data || {});
    renderOverview();
    renderList();
    if (activeBookingId === record.id) renderDetails();
  } catch (error) {
    console.warn("Could not reconcile legacy Stripe promotion code", error);
  }
}
function bookingField(record, key) {
  return record.data[key] ?? "";
}
function fieldGrid(container, fields) {
  const dl = document.createElement("dl");
  fields.forEach(([label, content]) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = text(content);
    dl.append(dt, dd);
  });
  container.appendChild(dl);
}
function detailSection(container, title, fields) {
  const heading = document.createElement("h3");
  heading.textContent = title;
  if (container.childNodes.length) heading.style.marginTop = "24px";
  container.appendChild(heading);
  fieldGrid(container, fields);
}
function renderDetails() {
  const panel = $("#booking-detail");
  if (!panel) return;
  panel.replaceChildren();
  const record = records.find((item) => item.id === activeBookingId);
  if (!record) {
    panel.textContent = "Select a booking to see its details.";
    return;
  }
  const b = record.data;
  const heading = document.createElement("h3");
  heading.textContent = b.customerName || "Unnamed customer";
  panel.appendChild(heading);
  const ref = document.createElement("p");
  ref.className = "muted-help";
  ref.textContent = "Booking reference: " + record.id;
  panel.appendChild(ref);
  const actionHost = document.createElement("div");
  actionHost.id = "booking-actions-host";
  panel.appendChild(actionHost);
  detailSection(panel, "Appointment", [
    ["Status", bookingStatus(b)], ["Inspection status", b.inspectionStatus],
    ["Availability lock", b.availabilityLockStatus], ["Availability issue", b.availabilityLockError],
    ["Date", b.preferredDateDisplay || b.preferredDate], ["Time", b.preferredTimeLabel || b.preferredTime],
    ["Property", b.propertyAddress], ["Pool type", b.poolType],
    ["Reason", b.inspectionReason], ["Pool registered", b.poolRegisteredStatus],
    ["Existing certificate", b.existingCertificateStatus], ["Pool exemption", b.hasPoolExemption === true ? "Yes" : "No"],
    ["Exemption file uploaded", b.exemptionFileUploaded === true ? "Yes" : "No"]
  ]);
  detailSection(panel, "Booking contact", [
    ["Name", b.customerName], ["Role", b.bookingRole || b.clientType],
    ["Company / agency", b.agencyName], ["Relationship", b.bookingRelationship],
    ["Email", b.email], ["Phone", b.phone],
    ["Authorised to book", b.authorisedToBook === true ? "Yes" : "No"]
  ]);
  detailSection(panel, "Pool owner and documents", [
    ["Pool owner status", b.poolOwnerStatus || (b.isPropertyOwner ? "Booking contact is owner" : "Not recorded")],
    ["Pool owner name", b.poolOwnerName || (b.isPropertyOwner ? b.customerName : "")],
    ["Pool owner email", b.poolOwnerEmail],
    ["Owner details follow-up", b.ownerDetailsPending === true ?
      "REQUIRED before inspection / compliance documents" : "No outstanding owner details recorded"],
    ["Document delivery", "Confirm the owner / authorised delivery recipient before issuing compliance paperwork."]
  ]);
  detailSection(panel, "Property access", [
    ["Same as booking contact", b.accessSameAsBooking === true ? "Yes" : "No"],
    ["Access contact", b.accessContactName || (b.accessSameAsBooking ? b.customerName : "")],
    ["Access phone", b.accessContactPhone || (b.accessSameAsBooking ? b.phone : "")],
    ["Access email", b.accessContactEmail || (b.accessSameAsBooking ? b.email : "")],
    ["Access agency", b.accessContactAgency],
    ["Access method", b.accessMethod], ["Key collection", b.keyCollectionLocation],
    ["Someone onsite", b.willBeHomeForInspection === true ? "Yes" : "No"],
    ["Access permission", b.accessPermissionIfNotHome === true ? "Yes" : "No"],
    ["Animals", b.animalsOnProperty === true ? "Yes" : "No"],
    ["Animals secured", b.animalsWillBeSecured === true ? "Yes" : "No"],
    ["Access instructions", b.accessInstructions], ["Notes", b.notes]
  ]);
  detailSection(panel, "Payment & integrations", [
    ["Payment status", b.paymentStatus], ["Payment method", b.paymentMethod],
    ["Billing status", billingLabel(b)],
    ["Stripe subtotal", safeAmount(b.stripeAmountSubtotal ?? b.priceCents)],
    ["Discount", safeAmount(b.stripeAmountDiscount ?? 0)],
    ["Promotion code", b.stripePromotionCode || (b.discountApplied ? "Discount code not yet reconciled" : "None")],
    ["Stripe cash received", safeAmount(stripeCashReceived(b))],
    ["Refunded", safeAmount(b.stripeAmountRefunded ?? 0)],
    ["Invoice amount due", isInvoiceBooking(b) ? safeAmount(b.invoiceAmountCents ?? b.stripeAmountSubtotal ?? b.priceCents) : "N/A"],
    ["Invoice number", b.invoiceNumber],
    ["Invoice status", b.invoiceStatus],
    ["Stripe PaymentIntent", b.stripePaymentIntentId],
    ["Calendar event", b.googleCalendarEventId ? "Linked" : "Not linked"],
    ["Calendar sync", b.calendarSyncStatus || "Not recorded"],
    ["Calendar sync error", b.calendarSyncError],
    ["Customer notification", b.customerNotificationError ? "Failed: " + b.customerNotificationError :
      (b.customerNotificationId && b.customerNotificationSentId === b.customerNotificationId ? "Sent" :
        b.customerNotificationId ? "Pending" : b.customerNotificationSentType || "Not recorded")]
  ]);
  renderBillingActions(panel, record);
  maybeReconcileLegacyBilling(record);
  window.dispatchEvent(new CustomEvent("irongate:booking-selected", { detail: { bookingId: record.id } }));
}
function filteredBookings() {
  const search = ($("#booking-search")?.value || "").trim().toLowerCase();
  const filter = $("#booking-status-filter")?.value || "all";
  return records.filter(({ id, data }) => {
    const status = bookingStatus(data).toLowerCase(), pay = String(data.paymentStatus || "").toLowerCase();
    const matches = filter === "all" ||
      (filter === "confirmed" && (status === "confirmed" || pay === "paid" || pay === "agency_invoice") && status !== "cancelled") ||
      (filter === "paid" && isStripePaidBooking(data)) ||
      (filter === "invoice" && isInvoiceBooking(data)) ||
      (filter === "pending" && (status.includes("pending") || pay.includes("checkout") || pay === "payment_processing")) ||
      (filter === "cancelled" && status === "cancelled") ||
      (filter === "completed" && (status === "completed" || status === "certificate_issued"));
    return matches && [id, data.customerName, data.email, data.agencyName,
      data.poolOwnerName, data.accessContactName, data.propertyAddress, data.preferredDate]
      .some((part) => String(part || "").toLowerCase().includes(search));
  });
}
function renderList() {
  const panel = $("#booking-list");
  if (!panel) return;
  panel.replaceChildren();
  const matches = filteredBookings();
  value("#bookings-message", matches.length + " of " + records.length + " recent bookings shown.");
  if (!matches.length) {
    const empty = document.createElement("p"); empty.className = "empty-blocks";
    empty.textContent = "No bookings match these filters."; panel.appendChild(empty);
  }
  matches.forEach(({ id, data }) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "booking-row";
    button.setAttribute("aria-pressed", String(id === activeBookingId));
    const name = document.createElement("strong"), date = document.createElement("span"), location = document.createElement("span"), status = document.createElement("span");
    name.textContent = data.customerName || "Unnamed customer";
    date.textContent = (data.preferredDateDisplay || data.preferredDate || "Date pending") + " · " + (data.preferredTimeLabel || data.preferredTime || "Time pending");
    location.textContent = data.propertyAddress || id;
    status.textContent = bookingStatus(data) + " · " + billingLabel(data);
    button.append(name, date, location, status);
    button.addEventListener("click", () => { activeBookingId = id; renderList(); renderDetails(); });
    panel.appendChild(button);
  });
}
function renderOverview() {
  const today = todayBrisbane();
  const eligible = records.filter(({ data }) => data.status === "confirmed" &&
    !TERMINAL.has(String(data.inspectionStatus || "").toLowerCase()));
  value("#ops-today", eligible.filter(({ data }) => data.preferredDate === today).length);
  value("#ops-upcoming", eligible.filter(({ data }) =>
    String(data.preferredDate || "") > today && ["paid", "agency_invoice"].includes(data.paymentStatus)).length);
  value("#ops-pending", eligible.filter(({ data }) =>
    ["pending_payment", "payment_processing"].includes(data.status) || data.paymentStatus === "checkout_created").length);
  value("#ops-cancelled", records.filter(({ data }) => data.status === "cancelled").length);
  const exceptions = records.filter(({ data }) => data.status === "payment_exception" ||
    data.availabilityLockStatus === "conflict");
  value("#ops-attention", exceptions.length + " paid booking(s) need manual availability review. " +
    (exceptions.length ? "Open Bookings and check Availability issue." : ""));
  const stripePaid = records.filter(({ data }) => isStripePaidBooking(data));
  const invoiceRequired = records.filter(({ data }) => isInvoiceBooking(data) && data.invoiceStatus !== "issued");
  const invoiceIssued = records.filter(({ data }) => isInvoiceBooking(data) && data.invoiceStatus === "issued");
  value("#overview-message", "Showing the latest " + records.length + " bookings; totals are not all-time figures.");
  value("#finance-stripe-paid", stripePaid.length);
  value("#finance-invoice-required", invoiceRequired.length);
  value("#finance-invoice-issued", invoiceIssued.length);
  value("#payments-overview", stripePaid.length + " Stripe-paid booking(s), " +
    invoiceRequired.length + " invoice(s) to generate, and " + invoiceIssued.length +
    " issued invoice(s) in the latest " + records.length + " records.");
}
async function loadBookings() {
  if (!authorized) return;
  const sequence = ++requestSequence;
  value("#bookings-message", "Loading recent bookings…");
  try {
    const snapshot = await getDocs(query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(150)));
    if (!authorized || sequence !== requestSequence) return;
    records = snapshot.docs.map((item) => ({ id: item.id, data: item.data() || {} }));
    if (activeBookingId && !records.some((item) => item.id === activeBookingId)) activeBookingId = "";
    renderOverview(); renderList(); renderDetails();
  } catch (error) {
    if (!authorized || sequence !== requestSequence) return;
    console.error("Could not load admin booking list", error);
    value("#bookings-message", "Could not load bookings. Check permissions and retry.");
    value("#overview-message", "Booking summary unavailable.");
  }
}
$("#booking-search")?.addEventListener("input", renderList);
$("#booking-status-filter")?.addEventListener("change", renderList);
$("#reload-bookings")?.addEventListener("click", loadBookings);
window.addEventListener("irongate:admin-tab", (event) => {
  if (["overview", "bookings", "payments"].includes(event.detail?.tab) && authorized) loadBookings();
});
onAuthStateChanged(auth, (user) => {
  authorized = Boolean(user && user.email?.trim().toLowerCase() === ADMIN_EMAIL);
  if (!authorized) {
    ++requestSequence; records = []; activeBookingId = "";
    value("#bookings-message", "Sign in with the approved admin account.");
    $("#booking-list")?.replaceChildren();
    $("#booking-detail")?.replaceChildren();
    return;
  }
  loadBookings();
});
