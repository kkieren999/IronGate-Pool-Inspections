import { app, db } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

// This module never writes booking records directly from the browser.
// Booking edits, payment and slot operations go through authenticated backend functions.
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
const reconcileBookingBilling = httpsCallable(functions, "adminReconcileBookingBilling");
const issueBookingInvoice = httpsCallable(functions, "adminIssueBookingInvoice");
const prepareInvoiceStripePayment = httpsCallable(functions, "adminPrepareInvoiceStripePayment");
const updateBookingDetails = httpsCallable(functions, "adminUpdateBookingDetails");
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
function isInvoicePaidBooking(booking = {}) {
  return isInvoiceBooking(booking) && booking.invoiceStatus === "paid" && stripeCashReceived(booking) > 0;
}
function billingLabel(booking = {}) {
  if (isInvoiceBooking(booking)) {
    if (booking.invoiceStatus === "paid") {
      return "INVOICE PAID — " + safeAmount(stripeCashReceived(booking)) + " RECEIVED VIA STRIPE";
    }
    if (booking.invoiceStatus === "issued") return "INVOICE ISSUED — AWAITING STRIPE PAYMENT";
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
function safeQrSvg(value) {
  const svg = String(value || "").trim();
  return /^<svg\b[^>]*>[\s\S]*<\/svg>$/.test(svg) ? svg : "";
}
function invoiceHtml(record) {
  const b = record.data || {};
  const amount = Number(b.invoiceAmountCents || b.stripeAmountSubtotal || b.priceCents || 14900);
  const customer = b.agencyName || b.customerName || "Client";
  const invoiceNumber = b.invoiceNumber || "Pending";
  const issueDate = b.invoiceIssuedDate || "";
  const dueDate = b.invoiceDueDate || "";
  const paid = b.invoiceStatus === "paid";
  const paymentUrl = String(b.stripeInvoicePaymentUrl || "");
  const qrSvg = safeQrSvg(b.invoicePaymentQrSvg);
  const paymentBlock = paid
    ? '<section class="stripe-pay paid"><div class="paid-mark">PAID</div><h3>Payment received through Stripe</h3><p><strong>' + escapeHtml(safeAmount(b.invoicePaidAmountCents || amount)) + '</strong> has been received securely through Stripe.</p>' +
      (b.stripeInvoicePaymentIntentId ? '<p class="small">Stripe reference: ' + escapeHtml(b.stripeInvoicePaymentIntentId) + '</p>' : '') + '</section>'
    : '<section class="stripe-pay"><div class="qr">' + qrSvg + '</div><div class="stripe-copy"><h3>Pay securely with Stripe</h3><p>Scan the QR code with your phone, or use the secure Stripe payment button below.</p>' +
      (paymentUrl ? '<a class="pay-btn" href="' + escapeHtml(paymentUrl) + '" target="_blank" rel="noopener">Pay ' + escapeHtml(safeAmount(amount)) + ' securely with Stripe</a>' : '<p><strong>Stripe payment link unavailable.</strong></p>') +
      '<p class="small">This payment link is for this invoice only. Promotion codes are disabled.</p></div></section>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${escapeHtml(invoiceNumber)} | Iron Gate Pool Inspections</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;margin:0;color:#12263a;background:#eef4f8}.toolbar{position:sticky;top:0;display:flex;gap:10px;justify-content:center;padding:12px;background:#08294f}.toolbar button{border:0;border-radius:9px;padding:11px 16px;font-weight:800;cursor:pointer}.print{background:#fff;color:#08294f}.close{background:#dceaf3;color:#08294f}.invoice{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:17mm;box-shadow:0 8px 30px rgba(0,0,0,.12)}.top{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #0b3867;padding-bottom:20px}.brand h1{margin:0;color:#08294f;font-size:27px}.brand p{margin:6px 0;color:#607789}.title{text-align:right}.title h2{margin:0;font-size:34px;color:#0b3867}.title div{margin-top:6px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}.box h3{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#647789;margin:0 0 8px}.box p{margin:4px 0;line-height:1.45}.line{width:100%;border-collapse:collapse;margin:24px 0}.line th,.line td{padding:13px 10px;border-bottom:1px solid #dbe5eb;text-align:left}.line th:last-child,.line td:last-child{text-align:right}.total{display:flex;justify-content:flex-end}.totalbox{width:300px}.totalrow{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #dbe5eb}.due{font-size:20px;font-weight:900;color:#08294f}.stripe-pay{margin-top:32px;padding:18px;border-radius:14px;background:#f3f8fb;display:grid;grid-template-columns:180px 1fr;gap:24px;align-items:center;border:1px solid #d9e6ee}.stripe-pay.paid{display:block;text-align:center;background:#eefaf2;border-color:#b8dfc2}.stripe-pay h3{margin:0 0 8px;color:#08294f}.qr{display:flex;align-items:center;justify-content:center;background:#fff;border-radius:10px;padding:10px}.qr svg{display:block;width:160px;height:160px}.pay-btn{display:inline-block;margin:8px 0;padding:12px 16px;border-radius:9px;background:#635bff;color:#fff;text-decoration:none;font-weight:900}.small{font-size:12px;color:#607789;line-height:1.45}.paid-mark{display:inline-block;margin-bottom:8px;padding:7px 14px;border-radius:999px;background:#14753a;color:#fff;font-weight:900;letter-spacing:.08em}.footer{margin-top:34px;padding-top:14px;border-top:1px solid #dbe5eb;color:#607789;font-size:12px}@media(max-width:800px){.invoice{width:auto;min-height:0;margin:0;padding:24px}.top,.grid,.stripe-pay{grid-template-columns:1fr;display:grid}.title{text-align:left}.qr{justify-self:start}}@media print{body{background:#fff}.toolbar{display:none}.invoice{width:auto;min-height:0;margin:0;box-shadow:none;padding:0}.pay-btn{border:1px solid #635bff}}
</style></head><body>
<div class="toolbar"><button class="print" onclick="window.print()">Print / Save PDF</button><button class="close" onclick="window.close()">Close</button></div>
<main class="invoice">
<section class="top"><div class="brand"><h1>Iron Gate Pool Inspections</h1><p>Pool Safety Inspection &amp; Certificate</p><p>irongatepool.com.au</p></div>
<div class="title"><h2>INVOICE</h2><div><strong>${escapeHtml(invoiceNumber)}</strong></div><div>Issued: ${escapeHtml(displayInvoiceDate(issueDate))}</div><div>Due: ${escapeHtml(displayInvoiceDate(dueDate))}</div></div></section>
<section class="grid"><div class="box"><h3>Bill to</h3><p><strong>${escapeHtml(customer)}</strong></p><p>${escapeHtml(b.customerName || "")}</p><p>${escapeHtml(b.email || "")}</p></div>
<div class="box"><h3>Inspection</h3><p><strong>${escapeHtml(b.propertyAddress || "")}</strong></p><p>${escapeHtml(b.preferredDateDisplay || b.preferredDate || "")}</p><p>Booking reference: ${escapeHtml(record.id)}</p></div></section>
<table class="line"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>Pool Safety Inspection &amp; Certificate</td><td>${escapeHtml(safeAmount(amount))}</td></tr></tbody></table>
<div class="total"><div class="totalbox">${paid ? '<div class="totalrow"><span>Amount paid</span><strong>' + escapeHtml(safeAmount(amount)) + '</strong></div><div class="totalrow due"><span>Balance due</span><span>$0.00</span></div>' : '<div class="totalrow due"><span>Amount due</span><span>' + escapeHtml(safeAmount(amount)) + '</span></div>'}</div></div>
${paymentBlock}
<p class="footer">Payment is accepted securely through Stripe only. This document is an Invoice, not a Tax Invoice.</p>
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
  win.document.write("<p style='font:16px Arial;padding:24px'>Preparing Stripe invoice…</p>");
  try {
    if (!record.data.invoiceNumber) {
      const response = await issueBookingInvoice({ bookingId: record.id });
      Object.assign(record.data, response.data || {});
      record.data.invoiceStatus = record.data.invoiceStatus || "issued";
      record.data.billingStatus = record.data.billingStatus || "invoice_issued";
    }
    if (record.data.invoiceStatus !== "paid") {
      const payment = await prepareInvoiceStripePayment({ bookingId: record.id });
      Object.assign(record.data, payment.data || {});
    }
    renderOverview();
    renderList();
    if (activeBookingId === record.id) renderDetails();
    renderInvoiceWindow(win, record);
  } catch (error) {
    console.error("Could not generate Stripe invoice", error);
    win.close();
    value("#bookings-message", error?.message || "Could not generate Stripe invoice.");
  }
}
function renderBillingActions(container, record) {
  const b = record.data || {};
  const box = document.createElement("div");
  box.className = "billing-admin-box";
  const badge = document.createElement("strong");
  badge.className = "billing-badge " + (isInvoicePaidBooking(b) ? "is-paid" : isInvoiceBooking(b) ? "is-invoice" : isStripePaidBooking(b) ? "is-paid" : "");
  badge.textContent = billingLabel(b);
  box.appendChild(badge);

  if (isInvoiceBooking(b)) {
    const note = document.createElement("p");
    note.className = "muted-help";
    if (b.invoiceStatus === "paid") {
      note.textContent = "Invoice " + (b.invoiceNumber || "") + " has been paid through Stripe.";
    } else if (b.invoiceStatus === "issued") {
      note.textContent = "Invoice " + (b.invoiceNumber || "") + " is awaiting Stripe payment. Its printable invoice includes a secure payment QR code.";
    } else {
      note.textContent = "Stripe collected $0.00 using INVOICE100. Generate the invoice to create its secure Stripe payment QR code.";
    }
    box.appendChild(note);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    button.textContent = b.invoiceStatus === "paid" ? "View / Print Paid Invoice" :
      b.invoiceStatus === "issued" ? "View / Print Invoice + QR" : "Generate Invoice + Stripe QR";
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

const EDITABLE_DETAIL_FIELDS = [
  { section: "Booking contact", key: "customerName", label: "Full name", required: true, max: 140 },
  { key: "email", label: "Email", type: "email", required: true, max: 180 },
  { key: "phone", label: "Phone", type: "tel", required: true, max: 30 },
  { key: "agencyName", label: "Company / agency", max: 180 },
  { key: "bookingRelationship", label: "Relationship to property / owner", max: 180 },
  { section: "Property", key: "propertyAddress", label: "Property address", required: true, max: 400 },
  { section: "Pool owner", key: "poolOwnerName", label: "Pool owner name", max: 140 },
  { key: "poolOwnerEmail", label: "Pool owner email", type: "email", max: 180 },
  { section: "Property access", key: "accessContactName", label: "Access contact name", max: 140 },
  { key: "accessContactPhone", label: "Access contact phone", type: "tel", max: 30 },
  { key: "accessContactEmail", label: "Access contact email", type: "email", max: 180 },
  { key: "accessContactAgency", label: "Access contact agency", max: 180 },
  { key: "keyCollectionLocation", label: "Key collection / lockbox details", max: 300 },
  { key: "accessInstructions", label: "Access instructions", max: 1200, multiline: true },
  { section: "Internal / customer notes", key: "notes", label: "Notes", max: 2000, multiline: true }
];

function editableValue(booking, key) {
  if (booking[key] !== undefined && booking[key] !== null) return String(booking[key]);
  if (key === "poolOwnerName" && booking.isPropertyOwner === true) return String(booking.customerName || "");
  if (key === "poolOwnerEmail" && booking.isPropertyOwner === true) return String(booking.email || "");
  if (booking.accessSameAsBooking === true) {
    if (key === "accessContactName") return String(booking.customerName || "");
    if (key === "accessContactPhone") return String(booking.phone || "");
    if (key === "accessContactEmail") return String(booking.email || "");
  }
  return "";
}

function renderBookingEditForm(container, record) {
  const booking = record.data || {};
  const wrapper = document.createElement("details");
  wrapper.className = "booking-edit-details";
  const summary = document.createElement("summary");
  summary.textContent = "Edit booking details";
  wrapper.appendChild(summary);

  const help = document.createElement("p");
  help.className = "muted-help";
  help.textContent = "Correct contact, property, owner/access details and notes here. Use Move for appointment time changes; payment and refund fields stay protected.";
  wrapper.appendChild(help);

  const form = document.createElement("form");
  form.className = "admin-form";
  form.autocomplete = "off";
  const initial = new Map();

  EDITABLE_DETAIL_FIELDS.forEach((field) => {
    if (field.section) {
      const heading = document.createElement("h4");
      heading.textContent = field.section;
      heading.style.margin = "8px 0 -4px";
      form.appendChild(heading);
    }
    const label = document.createElement("label");
    label.textContent = field.label;
    const input = field.multiline ? document.createElement("textarea") : document.createElement("input");
    if (!field.multiline) input.type = field.type || "text";
    input.name = field.key;
    input.maxLength = field.max;
    input.required = field.required === true;
    const current = editableValue(booking, field.key);
    input.value = current;
    initial.set(field.key, current.trim());
    label.appendChild(input);
    form.appendChild(label);
  });

  const note = document.createElement("p");
  note.className = "form-note";
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  form.appendChild(note);

  const button = document.createElement("button");
  button.type = "submit";
  button.className = "btn btn-primary";
  button.textContent = "Save booking details";
  form.appendChild(button);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!authorized || activeBookingId !== record.id) return;
    const details = {};
    EDITABLE_DETAIL_FIELDS.forEach((field) => {
      const input = form.elements.namedItem(field.key);
      const next = String(input?.value || "").trim();
      if (next !== initial.get(field.key)) details[field.key] = next;
    });
    if (!Object.keys(details).length) {
      note.textContent = "No changes to save.";
      note.dataset.type = "";
      return;
    }
    button.disabled = true;
    note.textContent = "Saving booking details…";
    note.dataset.type = "";
    try {
      const response = await updateBookingDetails({
        bookingId: record.id,
        actionId: crypto.randomUUID(),
        details
      });
      Object.assign(record.data, response.data?.details || details);
      renderOverview();
      renderList();
      renderDetails();
      value("#bookings-message", response.data?.noChanges
        ? "No booking detail changes were needed."
        : "Booking details saved. Calendar details will resync automatically when relevant.");
    } catch (error) {
      console.error("Could not update booking details", error);
      note.textContent = error?.message || "Booking details were not saved.";
      note.dataset.type = "error";
      button.disabled = false;
    }
  });

  wrapper.appendChild(form);
  container.appendChild(wrapper);
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
  renderBookingEditForm(panel, record);
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
    ["Invoice amount due", isInvoiceBooking(b) ? (b.invoiceStatus === "paid" ? "$0.00" : safeAmount(b.invoiceAmountCents ?? b.stripeAmountSubtotal ?? b.priceCents)) : "N/A"],
    ["Invoice number", b.invoiceNumber],
    ["Invoice status", b.invoiceStatus],
    ["Invoice payment status", b.invoicePaymentStatus],
    ["Invoice Stripe payment link", b.stripeInvoicePaymentUrl ? "Ready" : "Not created"],
    ["Invoice Stripe PaymentIntent", b.stripeInvoicePaymentIntentId],
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
  const invoiceRequired = records.filter(({ data }) => isInvoiceBooking(data) && !data.invoiceNumber);
  const invoiceIssued = records.filter(({ data }) => isInvoiceBooking(data) && data.invoiceStatus === "issued");
  const invoicePaid = records.filter(({ data }) => isInvoicePaidBooking(data));
  value("#overview-message", "Showing the latest " + records.length + " bookings; totals are not all-time figures.");
  value("#finance-stripe-paid", stripePaid.length);
  value("#finance-invoice-required", invoiceRequired.length);
  value("#finance-invoice-issued", invoiceIssued.length);
  value("#finance-invoice-paid", invoicePaid.length);
  value("#payments-overview", stripePaid.length + " direct Stripe-paid booking(s), " +
    invoiceRequired.length + " invoice(s) to generate, " + invoiceIssued.length +
    " invoice(s) awaiting Stripe payment, and " + invoicePaid.length +
    " invoice(s) paid via Stripe in the latest " + records.length + " records.");
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
