import { doc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const INVOICE_PROMO_CODE = "INVOICE100";

function promoCode(booking = {}) {
  return String(booking.stripePromotionCode || "").trim().toUpperCase();
}

function invoiceAmountCents(booking = {}) {
  const candidates = [booking.invoiceAmountCents, booking.stripeAmountSubtotal, booking.priceCents, 14900];
  for (const value of candidates) {
    const amount = Number(value);
    if (Number.isSafeInteger(amount) && amount > 0) return amount;
  }
  return 14900;
}

export async function markInvoicePaidByBankTransfer(db, record) {
  const booking = record?.data || {};
  const bookingId = String(record?.id || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,110}$/.test(bookingId)) {
    throw new Error("Invalid booking reference.");
  }
  if (booking.invoiceRequired !== true || promoCode(booking) !== INVOICE_PROMO_CODE) {
    throw new Error("This is not an INVOICE100 invoice booking.");
  }
  if (!booking.invoiceNumber) {
    throw new Error("Generate the invoice before marking it paid by bank transfer.");
  }
  if (booking.invoiceStatus === "paid") {
    throw new Error("This invoice is already marked as paid.");
  }

  const amountCents = invoiceAmountCents(booking);
  const actionId = crypto.randomUUID();
  const patch = {
    invoiceStatus: "paid",
    invoicePaymentStatus: "paid",
    invoicePaymentMethod: "bank_transfer",
    billingMethod: "invoice_bank_transfer",
    billingStatus: "invoice_paid_bank_transfer",
    invoicePaidAmountCents: amountCents,
    bankTransferReceivedCents: amountCents,
    invoiceBankPaidOverrideActionId: actionId,
    invoiceBankPaidAt: serverTimestamp(),
    paymentReceivedAt: serverTimestamp(),
    lastAdminActionId: actionId,
    lastAdminActionType: "invoice_bank_transfer_paid",
    updatedAt: serverTimestamp(),
    updatedBy: "admin_bank_transfer_override"
  };

  await updateDoc(doc(db, "bookings", bookingId), patch);

  return {
    invoiceStatus: "paid",
    invoicePaymentStatus: "paid",
    invoicePaymentMethod: "bank_transfer",
    billingMethod: "invoice_bank_transfer",
    billingStatus: "invoice_paid_bank_transfer",
    invoicePaidAmountCents: amountCents,
    bankTransferReceivedCents: amountCents,
    invoiceBankPaidOverrideActionId: actionId,
    lastAdminActionId: actionId,
    lastAdminActionType: "invoice_bank_transfer_paid"
  };
}
