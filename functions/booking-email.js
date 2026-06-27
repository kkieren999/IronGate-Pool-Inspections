const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");

const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function value(data, key, fallback = "Not provided") {
  const item = data?.[key];
  if (item === undefined || item === null || item === "") return fallback;
  return String(item);
}

function buildBookingEmail(bookingId, booking = {}) {
  const customerName = value(booking, "customerName");
  const rows = [
    ["Booking ID", bookingId],
    ["Name", customerName],
    ["Email", value(booking, "email")],
    ["Phone", value(booking, "phone")],
    ["Property", value(booking, "propertyAddress")],
    ["Preferred date", value(booking, "preferredDateDisplay", value(booking, "preferredDate"))],
    ["Preferred time", value(booking, "preferredTimeLabel", value(booking, "preferredTime"))],
    ["Inspection reason", value(booking, "inspectionReason")],
    ["Pool type", value(booking, "poolType")],
    ["Existing certificate", value(booking, "existingCertificateStatus")],
    ["Pool register status", value(booking, "poolRegisterStatus")],
    ["Pool register message", value(booking, "poolRegisterMessage")],
    ["Price", value(booking, "priceDisplay", "$249 inc GST")],
    ["Access instructions", value(booking, "accessInstructions", "No access instructions provided")],
    ["Notes", value(booking, "notes", "No notes provided")]
  ];

  const text = [
    "New IronGate booking request",
    "",
    ...rows.map(([label, rowValue]) => `${label}: ${rowValue}`),
    "",
    "Open Firebase Console > Firestore Database > bookings to view the full booking record."
  ].join("\n");

  const htmlRows = rows.map(([label, rowValue]) => `
    <tr>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e6eef7;color:#0a2540;width:190px;vertical-align:top;">${escapeHtml(label)}</th>
      <td style="padding:10px 12px;border-bottom:1px solid #e6eef7;color:#173557;vertical-align:top;">${escapeHtml(rowValue)}</td>
    </tr>
  `).join("");

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:720px;margin:0 auto;color:#173557;">
      <h1 style="color:#0a2540;margin:0 0 8px;">New IronGate booking request</h1>
      <p style="margin:0 0 22px;color:#4a5f78;">A client has submitted a booking request through the IronGate website.</p>
      <table style="width:100%;border-collapse:collapse;background:#ffffff;border:1px solid #e6eef7;border-radius:12px;overflow:hidden;">
        ${htmlRows}
      </table>
      <p style="margin:22px 0 0;color:#4a5f78;">Open Firebase Console &gt; Firestore Database &gt; bookings to view the full booking record.</p>
    </div>
  `;

  return {
    subject: `New IronGate booking request - ${customerName}`,
    text,
    html
  };
}

async function sendWithSendGrid({ to, fromEmail, fromName, replyTo, subject, text, html }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) throw new Error("Missing SENDGRID_API_KEY environment variable.");

  const payload = {
    personalizations: [{
      to: [{ email: to }],
      subject
    }],
    from: {
      email: fromEmail,
      name: fromName || "IronGate Pool Inspections"
    },
    content: [
      { type: "text/plain", value: text },
      { type: "text/html", value: html }
    ]
  };

  if (replyTo) payload.reply_to = { email: replyTo };

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`SendGrid email failed with HTTP ${response.status}: ${errorBody}`);
  }
}

exports.bookingNotificationEmail = onDocumentCreated({
  document: "bookings/{bookingId}",
  region: "nam5",
  timeoutSeconds: 30,
  memory: "256MiB"
}, async (event) => {
  const bookingId = event.params.bookingId;
  const booking = event.data?.data() || {};
  const email = buildBookingEmail(bookingId, booking);

  await sendWithSendGrid({
    to: process.env.BOOKING_NOTIFICATION_TO || ADMIN_EMAIL,
    fromEmail: process.env.SENDGRID_FROM_EMAIL || ADMIN_EMAIL,
    fromName: process.env.SENDGRID_FROM_NAME || "IronGate Pool Inspections",
    replyTo: booking.email || undefined,
    subject: email.subject,
    text: email.text,
    html: email.html
  });

  logger.info("Booking notification email sent", {
    bookingId,
    to: process.env.BOOKING_NOTIFICATION_TO || ADMIN_EMAIL
  });
});
