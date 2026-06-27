const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");

const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const DEFAULT_PRICE_DISPLAY = "$249";
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid", "agency_invoice"]);

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function field(data, key, fallback = "Not provided") {
  const value = data?.[key];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function priceField(booking = {}) {
  const rawPrice = field(booking, "priceDisplay", DEFAULT_PRICE_DISPLAY);
  return rawPrice.replace(/\s*inc\s+GST\s*/i, "").trim() || DEFAULT_PRICE_DISPLAY;
}

function hasJustBecomeConfirmed(before = {}, after = {}) {
  return !CONFIRMED_PAYMENT_STATUSES.has(before.paymentStatus) && CONFIRMED_PAYMENT_STATUSES.has(after.paymentStatus);
}

function buildEmail(bookingId, booking = {}) {
  const customerName = field(booking, "customerName");
  const isAgencyInvoice = booking.paymentStatus === "agency_invoice";
  const heading = isAgencyInvoice ? "Approved agency invoice booking" : "Paid IronGate booking confirmed";
  const intro = isAgencyInvoice
    ? "An approved agency partner has submitted an invoice-account booking through the IronGate website."
    : "A client has completed payment through the IronGate website.";

  const rows = [
    ["Booking ID", bookingId],
    ["Booking status", field(booking, "status")],
    ["Payment status", field(booking, "paymentStatus", isAgencyInvoice ? "agency_invoice" : "paid")],
    ["Payment method", field(booking, "paymentMethod")],
    ["Agency", field(booking, "agencyName")],
    ["Agency code", field(booking, "agencyPartnerCode")],
    ["Agency job reference", field(booking, "agencyJobReference")],
    ["Name", customerName],
    ["Email", field(booking, "email")],
    ["Phone", field(booking, "phone")],
    ["Owner", field(booking, "ownerName")],
    ["Property", field(booking, "propertyAddress")],
    ["Preferred date", field(booking, "preferredDateDisplay", field(booking, "preferredDate"))],
    ["Preferred time", field(booking, "preferredTimeLabel", field(booking, "preferredTime"))],
    ["Inspection reason", field(booking, "inspectionReason")],
    ["Pool type", field(booking, "poolType")],
    ["Existing certificate", field(booking, "existingCertificateStatus")],
    ["Pool register status", field(booking, "poolRegisterStatus")],
    ["Pool register message", field(booking, "poolRegisterMessage")],
    ["Price", priceField(booking)],
    ["Access instructions", field(booking, "accessInstructions", "No access instructions provided")],
    ["Notes", field(booking, "notes", "No notes provided")]
  ];

  const text = [
    heading,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Open Firebase Console > Firestore Database > bookings to view the full booking record."
  ].join("\n");

  const htmlRows = rows.map(([label, value]) => `
    <tr>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6eef7;color:#0a2540;width:190px;vertical-align:top;">${escapeHtml(label)}</th>
      <td style="padding:10px 12px;border-bottom:1px solid #e6eef7;color:#173557;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:#173557;">
      <h1 style="color:#0a2540;margin:0 0 8px;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 22px;color:#4a5f78;">${escapeHtml(intro)}</p>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e6eef7;border-radius:12px;overflow:hidden;">
        ${htmlRows}
      </table>
      <p style="margin:22px 0 0;color:#4a5f78;">Open Firebase Console &gt; Firestore Database &gt; bookings to view the full booking record.</p>
    </div>
  `;

  return {
    subject: isAgencyInvoice ? `Agency invoice booking - ${customerName}` : `Paid IronGate booking - ${customerName}`,
    text,
    html
  };
}

function createGmailTransporter() {
  const appPassword = GMAIL_APP_PASSWORD.value();
  if (!appPassword) throw new Error("GMAIL_APP_PASSWORD secret has not been set in Firebase.");

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: ADMIN_EMAIL,
      pass: appPassword
    }
  });
}

exports.bookingNotificationEmail = onDocumentUpdated({
  document: "bookings/{bookingId}",
  region: "us-central1",
  timeoutSeconds: 30,
  memory: "256MiB",
  secrets: [GMAIL_APP_PASSWORD]
}, async (event) => {
  const bookingId = event.params.bookingId;
  const before = event.data?.before?.data() || {};
  const booking = event.data?.after?.data() || {};

  if (!hasJustBecomeConfirmed(before, booking)) {
    logger.info("Booking email skipped because booking did not just become confirmed", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: booking.paymentStatus || null
    });
    return;
  }

  const email = buildEmail(bookingId, booking);
  const transporter = createGmailTransporter();

  await transporter.sendMail({
    from: `IronGate Pool Inspections <${ADMIN_EMAIL}>`,
    to: ADMIN_EMAIL,
    replyTo: booking.email || undefined,
    subject: email.subject,
    text: email.text,
    html: email.html
  });

  logger.info("Confirmed booking notification email sent", {
    bookingId,
    paymentStatus: booking.paymentStatus || null,
    to: ADMIN_EMAIL
  });
});
