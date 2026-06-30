const admin = require("firebase-admin");
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");

admin.initializeApp();

const GMAIL_APP_PASSWORD = defineSecret("GMAIL_APP_PASSWORD");
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const BUSINESS_PHONE = "0481 442 260";
const DEFAULT_PRICE_DISPLAY = "$249";
const CONFIRMED_PAYMENT_STATUSES = new Set(["paid"]);
const EMAIL_TEMPLATE_VERSION = "payment-confirmation-v1";
const ADMIN_UPDATE_TEMPLATE_VERSION = "booking-admin-update-v1";

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

function optionalField(data, key) {
  const value = data?.[key];
  if (value === undefined || value === null || value === "") return "";
  return String(value);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function priceField(booking = {}) {
  const rawPrice = field(booking, "priceDisplay", DEFAULT_PRICE_DISPLAY);
  return rawPrice.replace(/\s*inc\s+GST\s*/i, "").trim() || DEFAULT_PRICE_DISPLAY;
}

function amountFromCents(value, fallback = "") {
  if (!Number.isFinite(Number(value))) return fallback;
  const amount = Number(value) / 100;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD"
  }).format(amount);
}

function paymentAmount(booking = {}) {
  return amountFromCents(booking.stripeAmountTotal, priceField(booking));
}

function yesNo(value) {
  return value === true ? "Yes" : value === false ? "No" : "Not provided";
}

function hasJustBecomeConfirmed(before = {}, after = {}) {
  return !CONFIRMED_PAYMENT_STATUSES.has(before.paymentStatus) && CONFIRMED_PAYMENT_STATUSES.has(after.paymentStatus);
}

function hasNewCustomerNotification(before = {}, after = {}) {
  const beforeId = before.customerNotificationId || "";
  const afterId = after.customerNotificationId || "";
  return Boolean(afterId && afterId !== beforeId && after.customerNotificationType);
}

function detailRowsToText(rows = []) {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}

function detailRowsToHtml(rows = []) {
  return rows.map(([label, value]) => `
    <tr>
      <th style="text-align:left;padding:13px 14px;border-bottom:1px solid #e6eef7;color:#071834;width:210px;vertical-align:top;font-size:14px;line-height:1.35;">${escapeHtml(label)}</th>
      <td style="padding:13px 14px;border-bottom:1px solid #e6eef7;color:#173557;vertical-align:top;font-size:14px;line-height:1.45;">${escapeHtml(value)}</td>
    </tr>
  `).join("");
}

function baseEmailHtml({ preheader = "", title = "", badge = "", intro = "", body = "", footerNote = "" }) {
  return `
  <!doctype html>
  <html>
  <body style="margin:0;padding:0;background:#f5f9fd;font-family:Arial,Helvetica,sans-serif;color:#173557;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f9fd;margin:0;padding:28px 14px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:720px;background:#ffffff;border:1px solid #e6eef7;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(4,26,55,0.08);">
            <tr>
              <td style="background:#071834;padding:28px 30px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#8edcff;font-weight:900;">IronGate Pool Inspections</div>
                <div style="font-size:27px;line-height:1.08;font-weight:900;margin-top:8px;letter-spacing:-0.02em;">${escapeHtml(title)}</div>
                ${badge ? `<div style="display:inline-block;margin-top:16px;padding:8px 12px;border-radius:999px;background:#eaf8ff;color:#071834;font-size:13px;font-weight:900;">${escapeHtml(badge)}</div>` : ""}
              </td>
            </tr>
            <tr>
              <td style="padding:30px;">
                ${intro ? `<p style="margin:0 0 22px;color:#4a5f78;font-size:16px;line-height:1.6;">${escapeHtml(intro)}</p>` : ""}
                ${body}
                <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e6eef7;color:#6a7b90;font-size:13px;line-height:1.55;">
                  <strong style="color:#071834;">IronGate Pool Inspections</strong><br>
                  Phone: <a href="tel:0481442260" style="color:#159ee8;text-decoration:none;font-weight:700;">${BUSINESS_PHONE}</a><br>
                  Email: <a href="mailto:${ADMIN_EMAIL}" style="color:#159ee8;text-decoration:none;font-weight:700;">${ADMIN_EMAIL}</a>
                  ${footerNote ? `<p style="margin:12px 0 0;color:#6a7b90;">${escapeHtml(footerNote)}</p>` : ""}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

function buildCustomerEmail(bookingId, booking = {}) {
  const customerName = optionalField(booking, "customerName") || "there";
  const date = field(booking, "preferredDateDisplay", field(booking, "preferredDate"));
  const time = field(booking, "preferredTimeLabel", field(booking, "preferredTime"));
  const amount = paymentAmount(booking);

  const rows = [
    ["Booking reference", bookingId],
    ["Service", field(booking, "serviceName", "Pool Safety Inspection & Certificate")],
    ["Inspection date", date],
    ["Inspection time", time],
    ["Property", field(booking, "propertyAddress")],
    ["Amount paid", amount]
  ];

  const text = [
    `Hi ${customerName},`,
    "",
    "Thanks - your IronGate pool safety inspection booking is confirmed and your payment has been received securely through Stripe.",
    "",
    detailRowsToText(rows),
    "",
    "What happens next:",
    "IronGate will review the booking details and contact you if anything else is needed before the inspection.",
    "Please make sure the pool area can be safely accessed at the booked time.",
    "",
    "GST has not been charged. IronGate Pool Inspections is not currently registered for GST.",
    "",
    `Questions? Call ${BUSINESS_PHONE} or reply to this email.`,
    "",
    "IronGate Pool Inspections"
  ].join("\n");

  const body = `
    <p style="margin:0 0 18px;color:#173557;font-size:17px;line-height:1.55;"><strong>Hi ${escapeHtml(customerName)},</strong></p>
    <p style="margin:0 0 22px;color:#4a5f78;font-size:16px;line-height:1.6;">Thanks - your IronGate pool safety inspection booking is confirmed and your payment has been received securely through Stripe.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e6eef7;border-radius:16px;overflow:hidden;margin:0 0 24px;">
      ${detailRowsToHtml(rows)}
    </table>
    <div style="padding:18px 18px;border-radius:16px;background:#f5f9fd;border:1px solid #e6eef7;">
      <div style="font-size:15px;font-weight:900;color:#071834;margin-bottom:8px;">What happens next</div>
      <p style="margin:0;color:#4a5f78;font-size:15px;line-height:1.6;">IronGate will review the booking details and contact you if anything else is needed before the inspection. Please make sure the pool area can be safely accessed at the booked time.</p>
    </div>
  `;

  return {
    subject: "Your IronGate pool inspection booking is confirmed",
    text,
    html: baseEmailHtml({
      preheader: `Your IronGate booking is confirmed for ${date} at ${time}.`,
      title: "Booking confirmed",
      badge: "Payment received",
      body,
      footerNote: "GST has not been charged. IronGate Pool Inspections is not currently registered for GST."
    })
  };
}

function buildOwnerEmail(bookingId, booking = {}) {
  const customerName = field(booking, "customerName");
  const amount = paymentAmount(booking);
  const discount = amountFromCents(booking.stripeAmountDiscount, "$0.00");

  const rows = [
    ["Booking ID", bookingId],
    ["Booking status", field(booking, "status")],
    ["Payment status", field(booking, "paymentStatus", "paid")],
    ["Payment method", field(booking, "paymentMethod")],
    ["Amount paid", amount],
    ["Discount", discount],
    ["Stripe session", field(booking, "stripeCheckoutSessionId")],
    ["Stripe payment intent", field(booking, "stripePaymentIntentId")],
    ["Customer name", customerName],
    ["Customer email", field(booking, "email")],
    ["Customer phone", field(booking, "phone")],
    ["Client type", field(booking, "clientType")],
    ["Property", field(booking, "propertyAddress")],
    ["Inspection date", field(booking, "preferredDateDisplay", field(booking, "preferredDate"))],
    ["Inspection time", field(booking, "preferredTimeLabel", field(booking, "preferredTime"))],
    ["Inspection reason", field(booking, "inspectionReason")],
    ["Pool type", field(booking, "poolType")],
    ["Existing certificate", field(booking, "existingCertificateStatus")],
    ["Pool register status", field(booking, "poolRegisterStatus")],
    ["Pool register message", field(booking, "poolRegisterMessage")],
    ["Pool exemption", yesNo(booking.hasPoolExemption)],
    ["Exemption file uploaded", yesNo(booking.exemptionFileUploaded)],
    ["Will be home", yesNo(booking.willBeHomeForInspection)],
    ["Access permitted if not home", yesNo(booking.accessPermissionIfNotHome)],
    ["Animals on property", yesNo(booking.animalsOnProperty)],
    ["Animals will be secured", yesNo(booking.animalsWillBeSecured)],
    ["Access instructions", field(booking, "accessInstructions", "No access instructions provided")],
    ["Notes", field(booking, "notes", "No notes provided")]
  ];

  const text = [
    "Paid IronGate booking received",
    "",
    "A client has completed payment through the IronGate website.",
    "",
    detailRowsToText(rows),
    "",
    "Open Firebase Console > Firestore Database > bookings to view the full booking record."
  ].join("\n");

  const body = `
    <p style="margin:0 0 22px;color:#4a5f78;font-size:16px;line-height:1.6;">A client has completed payment through the IronGate website. Review the details below before attending.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e6eef7;border-radius:16px;overflow:hidden;">
      ${detailRowsToHtml(rows)}
    </table>
    <p style="margin:22px 0 0;color:#4a5f78;font-size:14px;line-height:1.55;">Open Firebase Console &gt; Firestore Database &gt; bookings to view the full booking record.</p>
  `;

  return {
    subject: `Paid IronGate booking - ${customerName}`,
    text,
    html: baseEmailHtml({
      preheader: `Paid booking received for ${customerName}.`,
      title: "Paid booking received",
      badge: "Owner notification",
      body
    })
  };
}

function adminUpdateCopy(type, booking = {}) {
  const date = field(booking, "preferredDateDisplay", field(booking, "preferredDate"));
  const time = field(booking, "preferredTimeLabel", field(booking, "preferredTime"));
  const previousDate = field(booking, "previousPreferredDate", "");
  const previousTime = field(booking, "previousPreferredTimeLabel", "");

  if (type === "booking_moved") {
    return {
      subject: "Your IronGate pool inspection has been updated",
      title: "Booking updated",
      badge: "New inspection time",
      intro: `Your IronGate pool safety inspection has been moved to ${date} at ${time}.`,
      rows: [
        ["New inspection date", date],
        ["New inspection time", time],
        ["Previous date", previousDate || "Not provided"],
        ["Previous time", previousTime || "Not provided"],
        ["Property", field(booking, "propertyAddress")]
      ]
    };
  }

  if (type === "booking_cancelled") {
    return {
      subject: "Your IronGate pool inspection has been cancelled",
      title: "Booking cancelled",
      badge: "Cancelled",
      intro: "Your IronGate pool safety inspection booking has been cancelled.",
      rows: [
        ["Cancelled inspection date", date],
        ["Cancelled inspection time", time],
        ["Property", field(booking, "propertyAddress")]
      ]
    };
  }

  if (type === "completed") {
    return {
      subject: "Your IronGate pool inspection is complete",
      title: "Inspection completed",
      badge: "Completed",
      intro: "Your IronGate pool safety inspection has been marked complete.",
      rows: [
        ["Inspection date", date],
        ["Inspection time", time],
        ["Property", field(booking, "propertyAddress")]
      ]
    };
  }

  if (type === "certificate_issued") {
    return {
      subject: "Your IronGate pool safety certificate has been issued",
      title: "Certificate issued",
      badge: "Certificate issued",
      intro: "Your IronGate pool safety certificate has been issued.",
      rows: [
        ["Inspection date", date],
        ["Inspection time", time],
        ["Property", field(booking, "propertyAddress")]
      ]
    };
  }

  return {
    subject: "Your IronGate booking has been updated",
    title: "Booking updated",
    badge: "Update",
    intro: "Your IronGate booking has been updated.",
    rows: [
      ["Inspection date", date],
      ["Inspection time", time],
      ["Property", field(booking, "propertyAddress")]
    ]
  };
}

function buildAdminUpdateEmail(bookingId, booking = {}) {
  const type = booking.customerNotificationType || "booking_updated";
  const copy = adminUpdateCopy(type, booking);
  const customerName = optionalField(booking, "customerName") || "there";
  const adminNote = optionalField(booking, "adminNote");
  const rows = [
    ["Booking reference", bookingId],
    ...copy.rows
  ];
  if (adminNote) rows.push(["Note", adminNote]);

  const text = [
    `Hi ${customerName},`,
    "",
    copy.intro,
    "",
    detailRowsToText(rows),
    "",
    `Questions? Call ${BUSINESS_PHONE} or reply to this email.`,
    "",
    "IronGate Pool Inspections"
  ].join("\n");

  const body = `
    <p style="margin:0 0 18px;color:#173557;font-size:17px;line-height:1.55;"><strong>Hi ${escapeHtml(customerName)},</strong></p>
    <p style="margin:0 0 22px;color:#4a5f78;font-size:16px;line-height:1.6;">${escapeHtml(copy.intro)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#ffffff;border:1px solid #e6eef7;border-radius:16px;overflow:hidden;margin:0 0 24px;">
      ${detailRowsToHtml(rows)}
    </table>
  `;

  return {
    subject: copy.subject,
    text,
    html: baseEmailHtml({
      preheader: copy.intro,
      title: copy.title,
      badge: copy.badge,
      body
    })
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

async function sendPaidBookingEmails(event, bookingId, booking = {}, transporter) {
  const ownerEmail = buildOwnerEmail(bookingId, booking);
  const customerAddress = String(booking.email || "").trim();
  const hasCustomerEmail = isValidEmail(customerAddress);

  await transporter.sendMail({
    from: `IronGate Pool Inspections <${ADMIN_EMAIL}>`,
    to: ADMIN_EMAIL,
    replyTo: hasCustomerEmail ? customerAddress : undefined,
    subject: ownerEmail.subject,
    text: ownerEmail.text,
    html: ownerEmail.html
  });

  if (hasCustomerEmail) {
    const customerEmail = buildCustomerEmail(bookingId, booking);
    await transporter.sendMail({
      from: `IronGate Pool Inspections <${ADMIN_EMAIL}>`,
      to: customerAddress,
      replyTo: ADMIN_EMAIL,
      subject: customerEmail.subject,
      text: customerEmail.text,
      html: customerEmail.html
    });
  } else {
    logger.warn("Customer confirmation email skipped because booking email was missing or invalid", {
      bookingId,
      email: booking.email || null
    });
  }

  await event.data.after.ref.set(
    {
      ownerNotificationEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      customerConfirmationEmailSentAt: hasCustomerEmail ? admin.firestore.FieldValue.serverTimestamp() : null,
      confirmationEmailTemplateVersion: EMAIL_TEMPLATE_VERSION,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  logger.info("Confirmed booking emails sent", {
    bookingId,
    paymentStatus: booking.paymentStatus || null,
    ownerEmail: ADMIN_EMAIL,
    customerEmail: hasCustomerEmail ? customerAddress : null
  });
}

async function sendCustomerUpdateEmail(event, bookingId, booking = {}, transporter) {
  const customerAddress = String(booking.email || "").trim();
  if (!isValidEmail(customerAddress)) {
    await event.data.after.ref.set({
      customerNotificationSkippedAt: admin.firestore.FieldValue.serverTimestamp(),
      customerNotificationError: "Missing or invalid customer email.",
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    logger.warn("Admin booking update email skipped because customer email was invalid", { bookingId, email: booking.email || null });
    return;
  }

  const updateEmail = buildAdminUpdateEmail(bookingId, booking);
  await transporter.sendMail({
    from: `IronGate Pool Inspections <${ADMIN_EMAIL}>`,
    to: customerAddress,
    replyTo: ADMIN_EMAIL,
    subject: updateEmail.subject,
    text: updateEmail.text,
    html: updateEmail.html
  });

  await event.data.after.ref.set({
    customerNotificationSentAt: admin.firestore.FieldValue.serverTimestamp(),
    customerNotificationSentType: booking.customerNotificationType || null,
    customerNotificationTemplateVersion: ADMIN_UPDATE_TEMPLATE_VERSION,
    customerNotificationError: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  logger.info("Admin booking update email sent", {
    bookingId,
    notificationType: booking.customerNotificationType || null,
    customerEmail: customerAddress
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
  const becameConfirmed = hasJustBecomeConfirmed(before, booking);
  const hasAdminNotification = hasNewCustomerNotification(before, booking);

  if (!becameConfirmed && !hasAdminNotification) {
    logger.info("Booking email skipped because no email-triggering change occurred", {
      bookingId,
      beforePaymentStatus: before.paymentStatus || null,
      afterPaymentStatus: booking.paymentStatus || null,
      customerNotificationType: booking.customerNotificationType || null
    });
    return;
  }

  const transporter = createGmailTransporter();

  if (becameConfirmed) {
    await sendPaidBookingEmails(event, bookingId, booking, transporter);
  }

  if (hasAdminNotification) {
    await sendCustomerUpdateEmail(event, bookingId, booking, transporter);
  }
});
