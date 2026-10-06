import { app, db } from "./firebase-config.js";
import { markInvoicePaidByBankTransfer } from "./admin-bank-payment.js";
import { saveBarrierCheckInspectionLink } from "./admin-barriercheck-link.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

// Booking edits, Stripe payment reconciliation and slot operations go through authenticated backend functions.
// The bank-transfer paid override is limited to the signed-in admin account by Firestore rules.
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
const BUSINESS_ABN = "25 342 746 679";
const BANK_BSB = "084 034";
const BANK_ACCOUNT = "365754825";
const BUSINESS_NAME = "Iron Gate Pool Inspections";

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
function amountCents(booking = {}) {
  const candidates = [booking.invoiceAmountCents, booking.stripeAmountSubtotal, booking.priceCents, 14900];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return 14900;
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
function invoiceReceivedCents(booking = {}) {
  const direct = Number(booking.invoicePaidAmountCents ?? booking.bankTransferReceivedCents);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  return stripeCashReceived(booking);
}
function invoicePaidMethod(booking = {}) {
  if (booking.invoicePaymentMethod === "bank_transfer" || booking.billingMethod === "invoice_bank_transfer") return "BANK TRANSFER";
  if (booking.invoiceStatus === "paid") return "STRIPE";
  return "";
}
function isStripePaidBooking(booking = {}) {
  return !isInvoiceBooking(booking) && booking.paymentStatus === "paid" && stripeCashReceived(booking) > 0;
}
function isInvoicePaidBooking(booking = {}) {
  return isInvoiceBooking(booking) && booking.invoiceStatus === "paid" && invoiceReceivedCents(booking) > 0;
}
function billingLabel(booking = {}) {
  if (isInvoiceBooking(booking)) {
    if (booking.invoiceStatus === "paid") {
      const method = invoicePaidMethod(booking) || "PAYMENT";
      return "INVOICE PAID — " + safeAmount(invoiceReceivedCents(booking)) + " RECEIVED VIA " + method;
    }
    if (booking.invoiceStatus === "issued") return "INVOICE ISSUED — AWAITING PAYMENT";
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
  const amount = amountCents(b);
  const paid = b.invoiceStatus === "paid";
  const balance = paid ? 0 : amount;
  const customer = b.poolOwnerName || (b.isPropertyOwner ? b.customerName : "") || b.customerName || "Client";
  const customerEmail = b.poolOwnerEmail || (b.isPropertyOwner ? b.email : "") || "";
  const customerPhone = b.poolOwnerPhone || (b.isPropertyOwner ? b.phone : "") || "";
  const payer = b.agencyName || b.customerName || customer;
  const payerEmail = b.email || customerEmail;
  const invoiceNumber = b.invoiceNumber || "Pending";
  const issueDate = b.invoiceIssuedDate || "";
  const dueDate = b.invoiceDueDate || "";
  const paymentUrl = String(b.stripeInvoicePaymentUrl || "");
  const qrSvg = safeQrSvg(b.invoicePaymentQrSvg);
  const paidMethod = invoicePaidMethod(b);
  const stripeReference = b.stripeInvoicePaymentIntentId || b.stripeInvoicePaymentSessionId || "";
  const paymentBlock = paid
    ? '<section class="paid-card"><div class="paid-mark">PAID</div><h3>Payment received' + (paidMethod ? ' by ' + escapeHtml(paidMethod.toLowerCase()) : '') + '</h3><p><strong>' + escapeHtml(safeAmount(invoiceReceivedCents(b) || amount)) + '</strong> has been received.</p>' +
      (paidMethod === "STRIPE" && stripeReference ? '<p class="small">Stripe reference: ' + escapeHtml(stripeReference) + '</p>' : '') + '</section>'
    : '<section class="payment-options"><div class="bank-card"><h3>Bank transfer</h3><dl><div><dt>Account name</dt><dd>' + escapeHtml(BUSINESS_NAME) + '</dd></div><div><dt>BSB</dt><dd>' + escapeHtml(BANK_BSB) + '</dd></div><div><dt>Account number</dt><dd>' + escapeHtml(BANK_ACCOUNT) + '</dd></div><div><dt>Reference</dt><dd>' + escapeHtml(invoiceNumber) + '</dd></div></dl></div>' +
      '<div class="stripe-card"><div class="qr">' + qrSvg + '</div><div><h3>Pay securely with Stripe</h3><p>Scan the QR code with your phone, or use the secure Stripe payment button below.</p>' +
      (paymentUrl ? '<a class="pay-btn" href="' + escapeHtml(paymentUrl) + '" target="_blank" rel="noopener">Pay ' + escapeHtml(safeAmount(amount)) + ' securely with Stripe</a>' : '<p><strong>Stripe payment link unavailable.</strong></p>') +
      '<p class="small">This payment link is for this invoice only. Promotion codes are disabled.</p></div></div></section>';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${escapeHtml(invoiceNumber)} | Iron Gate Pool Inspections</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#12263a;background:#eef4f8}.toolbar{position:sticky;top:0;display:flex;gap:10px;justify-content:center;padding:12px;background:#08294f;z-index:4}.toolbar button{border:0;border-radius:9px;padding:11px 16px;font-weight:800;cursor:pointer}.print{background:#fff;color:#08294f}.close{background:#dceaf3;color:#08294f}.invoice{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:16mm 17mm;box-shadow:0 8px 30px rgba(0,0,0,.12)}.top{display:grid;grid-template-columns:1fr auto;gap:30px;align-items:start;border-bottom:3px solid #0b3867;padding-bottom:20px}.brand h1{margin:0;color:#08294f;font-size:28px;letter-spacing:-.02em}.brand p{margin:5px 0;color:#607789;font-weight:700}.business-meta{margin-top:13px;display:grid;gap:4px;color:#12263a;font-size:13px}.title{text-align:right;min-width:210px}.title h2{margin:0 0 10px;font-size:36px;color:#0b3867;letter-spacing:.03em}.title div{margin-top:5px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:28px 0}.box{padding:18px;border-radius:15px;background:#f7fbff;border:1px solid #dbe8f0}.box h3{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:#647789;margin:0 0 10px}.box p{margin:4px 0;line-height:1.45}.line{width:100%;border-collapse:collapse;margin:24px 0}.line th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#647789}.line th,.line td{padding:13px 10px;border-bottom:1px solid #dbe5eb;text-align:left}.line th:nth-child(n+2),.line td:nth-child(n+2){text-align:right}.total{display:flex;justify-content:flex-end}.totalbox{width:320px}.totalrow{display:flex;justify-content:space-between;gap:18px;padding:10px 0;border-bottom:1px solid #dbe5eb}.due{font-size:20px;font-weight:900;color:#08294f}.payment-options{margin-top:30px;display:grid;grid-template-columns:.9fr 1.1fr;gap:18px}.bank-card,.stripe-card,.paid-card{padding:18px;border-radius:16px;background:#f3f8fb;border:1px solid #d9e6ee}.bank-card h3,.stripe-card h3,.paid-card h3{margin:0 0 10px;color:#08294f}.bank-card dl{margin:0;display:grid;gap:9px}.bank-card div{display:grid;grid-template-columns:115px 1fr;gap:10px}.bank-card dt{color:#607789;font-weight:800}.bank-card dd{margin:0;font-weight:900}.stripe-card{display:grid;grid-template-columns:152px 1fr;gap:18px;align-items:center}.qr{display:flex;align-items:center;justify-content:center;background:#fff;border-radius:12px;padding:10px}.qr svg{display:block;width:130px;height:130px}.pay-btn{display:inline-block;margin:8px 0;padding:12px 16px;border-radius:9px;background:#635bff;color:#fff;text-decoration:none;font-weight:900}.small{font-size:12px;color:#607789;line-height:1.45}.paid-card{text-align:center;background:#eefaf2;border-color:#b8dfc2}.paid-mark{display:inline-block;margin-bottom:8px;padding:7px 14px;border-radius:999px;background:#14753a;color:#fff;font-weight:900;letter-spacing:.08em}.footer{margin-top:28px;padding-top:14px;border-top:1px solid #dbe5eb;color:#607789;font-size:12px;line-height:1.45}@media(max-width:800px){.invoice{width:auto;min-height:0;margin:0;padding:24px}.top,.grid,.payment-options,.stripe-card{grid-template-columns:1fr}.title{text-align:left}.qr{justify-self:start}}@media print{body{background:#fff}.toolbar{display:none}.invoice{width:auto;min-height:0;margin:0;box-shadow:none;padding:0}.pay-btn{border:1px solid #635bff;color:#635bff;background:#fff}.payment-options{break-inside:avoid}.box,.bank-card,.stripe-card,.paid-card{break-inside:avoid}}
</style></head><body>
<div class="toolbar"><button class="print" onclick="window.print()">Print / Save PDF</button><button class="close" onclick="window.close()">Close</button></div>
<main class="invoice">
<section class="top"><div class="brand"><h1>Iron Gate Pool Inspections</h1><p>Pool Safety Inspection &amp; Certificate</p><p>irongatepool.com.au</p><div class="business-meta"><span><strong>ABN:</strong> ${escapeHtml(BUSINESS_ABN)}</span><span><strong>GST:</strong> $0.00</span></div></div>
<div class="title"><h2>INVOICE</h2><div><strong>${escapeHtml(invoiceNumber)}</strong></div><div>Issued: ${escapeHtml(displayInvoiceDate(issueDate))}</div><div>Due: ${escapeHtml(displayInvoiceDate(dueDate))}</div></div></section>
<section class="grid"><div class="box"><h3>Bill to</h3><p><strong>${escapeHtml(payer)}</strong></p><p>${escapeHtml(customer)}</p><p>${escapeHtml(payerEmail)}</p><p>${escapeHtml(customerPhone)}</p></div>
<div class="box"><h3>Inspection</h3><p><strong>${escapeHtml(b.propertyAddress || "")}</strong></p><p>${escapeHtml(b.preferredDateDisplay || b.preferredDate || "")}</p><p>Booking reference: ${escapeHtml(record.id)}</p></div></section>
<table class="line"><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>GST</th><th>Amount AUD</th></tr></thead><tbody><tr><td>Pool Safety Inspection &amp; Certificate</td><td>1.00</td><td>${escapeHtml(safeAmount(amount))}</td><td>$0.00</td><td>${escapeHtml(safeAmount(amount))}</td></tr></tbody></table>
<div class="total"><div class="totalbox"><div class="totalrow"><span>Subtotal</span><strong>${escapeHtml(safeAmount(amount))}</strong></div><div class="totalrow"><span>GST</span><strong>$0.00</strong></div>${paid ? '<div class="totalrow"><span>Amount paid</span><strong>' + escapeHtml(safeAmount(invoiceReceivedCents(b) || amount)) + '</strong></div>' : ''}<div class="totalrow due"><span>${paid ? 'Balance due' : 'Amount due'}</span><span>${escapeHtml(safeAmount(balance))}</span></div></div></div>
${paymentBlock}
<p class="footer">Payment can be made by bank transfer or securely by card through Stripe. This invoice shows GST as $0.00 because GST has not been charged.</p>
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
    console.error("Could not generate invoice", error);
    win.close();
    value("#bookings-message", error?.message || "Could not generate invoice.");
  }
}
async function markBankTransferPaid(record, button) {
  const b = record.data || {};
  const invoiceNumber = b.invoiceNumber || record.id;
  const amount = safeAmount(amountCents(b));
  const ok = window.confirm("Mark invoice " + invoiceNumber + " as PAID by bank transfer for " + amount + "?\n\nUse this only after the money has appeared in your bank account.");
  if (!ok) return;
  if (button) button.disabled = true;
  value("#bookings-message", "Marking invoice as paid by bank transfer…");
  try {
    const patch = await markInvoicePaidByBankTransfer(db, record);
    Object.assign(record.data, patch);
    renderOverview();
    renderList();
    if (activeBookingId === record.id) renderDetails();
    value("#bookings-message", "Invoice " + invoiceNumber + " marked as paid by bank transfer.");
  } catch (error) {
    console.error("Could not mark invoice paid by bank transfer", error);
    value("#bookings-message", error?.message || "Could not mark invoice as paid by bank transfer.");
    if (button) button.disabled = false;
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
      note.textContent = "Invoice " + (b.invoiceNumber || "") + " has been paid via " + (invoicePaidMethod(b).toLowerCase() || "payment") + ".";
    } else if (b.invoiceStatus === "issued") {
      note.textContent = "Invoice " + (b.invoiceNumber || "") + " is awaiting payment. Its printable invoice includes bank-transfer details and a secure Stripe QR code.";
    } else {
      note.textContent = "Stripe collected $0.00 using INVOICE100. Generate the invoice to create bank-transfer details and its secure Stripe payment QR code.";
    }
    box.appendChild(note);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary";
    button.textContent = b.invoiceStatus === "paid" ? "View / Print Paid Invoice" :
      b.invoiceStatus === "issued" ? "View / Print Invoice" : "Generate Invoice";
    button.addEventListener("click", () => createOrOpenInvoice(record));
    box.appendChild(button);

    if (b.invoiceNumber && b.invoiceStatus !== "paid") {
      const bankButton = document.createElement("button");
      bankButton.type = "button";
      bankButton.className = "btn soft-btn";
      bankButton.textContent = "Mark paid by bank transfer";
      bankButton.addEventListener("click", () => markBankTransferPaid(record, bankButton));
      box.appendChild(bankButton);
    }
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
  { section: "Client / pool owner", key: "poolOwnerName", label: "Pool owner name", required: true, max: 180 },
  { key: "poolOwnerEmail", label: "Pool owner email", type: "email", required: true, max: 180 },
  { key: "poolOwnerPhone", label: "Pool owner phone", type: "tel", required: true, max: 22 },
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
  if (key === "poolOwnerPhone" && booking.isPropertyOwner === true) return String(booking.phone || "");
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

const BARRIERCHECK_ORIGIN = "https://barriercheck.com.au";
const BARRIERCHECK_IMPORT_URL = BARRIERCHECK_ORIGIN + "/BarrierCheck_APP/app/index.html?from=irongate";

function barrierCheckEligible(booking = {}) {
  return booking.status === "confirmed" &&
    ["paid", "no_payment_required", "agency_invoice"].includes(String(booking.paymentStatus || ""));
}

function barrierCheckBookingPayload(record) {
  const b = record.data || {};
  const keys = [
    "status", "paymentStatus", "customerName", "email", "phone", "propertyAddress",
    "propertyPlaceId", "bookingRoleCode", "clientType", "agencyName", "bookingRelationship",
    "poolOwnerName", "poolOwnerEmail", "poolOwnerPhone", "accessSameAsBooking",
    "accessContactName", "accessContactPhone", "accessContactEmail", "accessContactAgency",
    "accessMethod", "keyCollectionLocation", "inspectionReason", "poolType",
    "existingCertificateStatus", "poolRegisteredStatus", "preferredDate",
    "preferredDateDisplay", "preferredTimeSlot", "preferredTimeLabel", "preferredTimeStart",
    "preferredTimeEnd", "preferredTime", "willBeHomeForInspection",
    "accessPermissionIfNotHome", "animalsOnProperty", "animalsOffLeash",
    "animalsWillBeSecured", "accessInstructions", "hasPoolExemption", "notes"
  ];
  const booking = {};
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(b, key)) booking[key] = b[key];
  });
  return {
    type: "irongate-create-inspection",
    version: 1,
    bookingId: record.id,
    booking
  };
}

async function saveBarrierCheckLink(record, result) {
  const saved = await saveBarrierCheckInspectionLink(record.id, result);
  if (!saved) return;
  record.data.barrierCheckInspectionId = saved.inspectionId;
  record.data.barrierCheckSyncStatus = saved.barrierCheckSyncStatus;
}

function openBarrierCheckInspection(record) {
  const b = record.data || {};
  if (!b.barrierCheckInspectionId && !barrierCheckEligible(b)) {
    value("#bookings-message", "BarrierCheck can be created after the booking is confirmed and payment is valid.");
    return;
  }

  const popup = window.open(BARRIERCHECK_IMPORT_URL, "barriercheck_" + record.id);
  if (!popup) {
    value("#bookings-message", "Your browser blocked BarrierCheck. Allow pop-ups for IronGate and try again.");
    return;
  }

  const payload = barrierCheckBookingPayload(record);
  let finished = false;
  let fallbackTimer = null;
  let timeoutTimer = null;

  function cleanup() {
    window.removeEventListener("message", onMessage);
    if (fallbackTimer) window.clearTimeout(fallbackTimer);
    if (timeoutTimer) window.clearTimeout(timeoutTimer);
  }

  function sendPayload() {
    if (finished || popup.closed) return;
    popup.postMessage(payload, BARRIERCHECK_ORIGIN);
    value("#bookings-message", "Sending booking details to BarrierCheck…");
  }

  async function onMessage(event) {
    if (event.origin !== BARRIERCHECK_ORIGIN || event.source !== popup) return;
    const data = event.data || {};

    if (data.type === "barriercheck-ready") {
      sendPayload();
      return;
    }

    if (data.type !== "barriercheck-import-result" || data.bookingId !== record.id) return;
    finished = true;
    cleanup();

    if (!data.ok) {
      value("#bookings-message", data.error || "BarrierCheck could not create the inspection.");
      return;
    }

    try {
      await saveBarrierCheckLink(record, data);
      renderDetails();
      value("#bookings-message", data.reused
        ? "Opened the existing BarrierCheck inspection."
        : "BarrierCheck inspection created and prefilled.");
    } catch (error) {
      console.error("BarrierCheck inspection was created but IronGate could not record the link", error);
      value("#bookings-message", "BarrierCheck inspection created, but IronGate could not save its inspection reference.");
    }
  }

  window.addEventListener("message", onMessage);
  fallbackTimer = window.setTimeout(sendPayload, 1200);
  timeoutTimer = window.setTimeout(() => {
    if (finished) return;
    cleanup();
    value("#bookings-message", "BarrierCheck did not confirm the import. Sign in to BarrierCheck in the opened window, then click Create in BarrierCheck again.");
  }, 60000);
}

function renderBarrierCheckAction(container, record) {
  const b = record.data || {};
  const box = document.createElement("div");
  box.className = "billing-admin-box";

  const badge = document.createElement("strong");
  badge.className = "billing-badge " + (b.barrierCheckInspectionId ? "is-paid" : "");
  badge.textContent = b.barrierCheckInspectionId ? "BarrierCheck linked" : "BarrierCheck";
  box.appendChild(badge);

  const note = document.createElement("p");
  note.className = "muted-help";
  if (b.barrierCheckInspectionId) {
    note.textContent = "Inspection reference: " + b.barrierCheckInspectionId + ". Opening it again will reuse the same IronGate-linked inspection.";
  } else if (barrierCheckEligible(b)) {
    note.textContent = "Create a BarrierCheck inspection with the client, property, appointment and access details already filled in.";
  } else {
    note.textContent = "Available once this booking is confirmed with a valid payment status.";
  }
  box.appendChild(note);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-primary";
  button.textContent = b.barrierCheckInspectionId ? "Open in BarrierCheck" : "Create in BarrierCheck";
  button.disabled = !b.barrierCheckInspectionId && !barrierCheckEligible(b);
  button.addEventListener("click", () => openBarrierCheckInspection(record));
  box.appendChild(button);
  container.appendChild(box);
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
  heading.textContent = b.poolOwnerName || (b.isPropertyOwner ? b.customerName : "") || b.customerName || "Unnamed client";
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
  detailSection(panel, "Client / pool owner", [
    ["Name", b.poolOwnerName || (b.isPropertyOwner ? b.customerName : "")],
    ["Email", b.poolOwnerEmail || (b.isPropertyOwner ? b.email : "")],
    ["Phone", b.poolOwnerPhone || (b.isPropertyOwner ? b.phone : "")],
    ["Used for", "Primary client record, invoices and compliance documents"]
  ]);
  detailSection(panel, "Booking / access contact (reference)", [
    ["Name", b.customerName], ["Role", b.bookingRole || b.clientType],
    ["Company / agency", b.agencyName], ["Relationship", b.bookingRelationship],
    ["Email", b.email], ["Phone", b.phone],
    ["Authorised to book", b.authorisedToBook === true ? "Yes" : "No"]
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
    ["Invoice cash received", isInvoiceBooking(b) ? safeAmount(invoiceReceivedCents(b)) : "N/A"],
    ["Invoice payment method", b.invoicePaymentMethod || (b.billingMethod === "invoice_bank_transfer" ? "bank_transfer" : "")],
    ["Refunded", safeAmount(b.stripeAmountRefunded ?? 0)],
    ["Invoice amount due", isInvoiceBooking(b) ? (b.invoiceStatus === "paid" ? "$0.00" : safeAmount(amountCents(b))) : "N/A"],
    ["Invoice number", b.invoiceNumber],
    ["Invoice status", b.invoiceStatus],
    ["Invoice payment status", b.invoicePaymentStatus],
    ["Invoice Stripe payment link", b.stripeInvoicePaymentUrl ? "Ready" : "Not created"],
    ["Invoice Stripe PaymentIntent", b.stripeInvoicePaymentIntentId],
    ["Stripe PaymentIntent", b.stripePaymentIntentId],
    ["Calendar event", b.googleCalendarEventId ? "Linked" : "Not linked"],
    ["Calendar sync", b.calendarSyncStatus || "Not recorded"],
    ["BarrierCheck inspection", b.barrierCheckInspectionId ? "Linked: " + b.barrierCheckInspectionId : "Not linked"],
    ["BarrierCheck sync", b.barrierCheckSyncStatus || "Not recorded"],
    ["BarrierCheck sync error", b.barrierCheckSyncError],
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
    return matches && [id, data.poolOwnerName, data.poolOwnerEmail, data.poolOwnerPhone,
      data.customerName, data.email, data.phone, data.agencyName,
      data.accessContactName, data.propertyAddress, data.preferredDate]
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
    name.textContent = data.poolOwnerName || (data.isPropertyOwner ? data.customerName : "") || data.customerName || "Unnamed client";
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
  const invoiceBankPaid = records.filter(({ data }) => isInvoicePaidBooking(data) && invoicePaidMethod(data) === "BANK TRANSFER");
  const invoiceStripePaid = records.filter(({ data }) => isInvoicePaidBooking(data) && invoicePaidMethod(data) === "STRIPE");
  value("#overview-message", "Showing the latest " + records.length + " bookings; totals are not all-time figures.");
  value("#finance-stripe-paid", stripePaid.length);
  value("#finance-invoice-required", invoiceRequired.length);
  value("#finance-invoice-issued", invoiceIssued.length);
  value("#finance-invoice-paid", invoicePaid.length);
  value("#payments-overview", stripePaid.length + " direct Stripe-paid booking(s), " +
    invoiceRequired.length + " invoice(s) to generate, " + invoiceIssued.length +
    " invoice(s) awaiting payment, " + invoiceStripePaid.length + " invoice(s) paid via Stripe, and " +
    invoiceBankPaid.length + " invoice(s) marked paid by bank transfer in the latest " + records.length + " records.");
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
