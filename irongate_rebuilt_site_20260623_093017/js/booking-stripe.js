import "./booking-customer-type.js";
import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const submitButton = document.querySelector("#booking-submit");
const message = document.querySelector("#booking-message");
const priceNotice = document.querySelector("#booking-price-notice");
const functions = getFunctions(app, "us-central1");
const createBookingCheckoutSession = httpsCallable(functions, "createBookingCheckoutSession");
const createAgencyInvoiceBooking = httpsCallable(functions, "createAgencyInvoiceBooking");

let redirectStarted = false;

function getBookingContext() {
  return window.ironGateBookingContext || { customerType: "homeowner", requestedPaymentMethod: "pay_now" };
}

function setCustomerFacingCopy() {
  if (priceNotice) priceNotice.textContent = "Pool Safety Inspection & Certificate — $249";
  if (submitButton && !submitButton.disabled) submitButton.textContent = "Continue to Secure Payment";
}

function extractBookingId(text) {
  const value = String(text || "");
  const bookingIdMatch = value.match(/Booking ID:\s*([A-Za-z0-9_-]+)/i);
  if (bookingIdMatch?.[1]) return bookingIdMatch[1];

  const referenceMatch = value.match(/Reference:\s*([A-Za-z0-9_-]+)/i);
  if (referenceMatch?.[1]) return referenceMatch[1];

  return "";
}

function buildPageUrl(path, bookingId = "") {
  const url = new URL(path, window.location.origin);
  if (bookingId) url.searchParams.set("bookingId", bookingId);
  return url.toString();
}

function shouldUseAgencyInvoice(context = {}) {
  return context.customerType === "agent" && context.requestedPaymentMethod === "agency_invoice";
}

async function finaliseAgencyInvoiceBooking(bookingId, context) {
  if (!context.agencyPartnerCode) {
    throw new Error("Agency partner code is required for invoice bookings.");
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting agency invoice booking...";
  }
  if (message) {
    message.textContent = "Booking request saved. Checking approved agency invoice account...";
    message.dataset.type = "success";
  }

  await createAgencyInvoiceBooking({
    bookingId,
    bookingContext: context
  });

  window.location.assign(buildPageUrl("/agency-booking-received/", bookingId));
}

async function redirectToStripeCheckout(bookingId) {
  if (!bookingId || redirectStarted) return;
  redirectStarted = true;

  const bookingContext = getBookingContext();

  try {
    if (shouldUseAgencyInvoice(bookingContext)) {
      await finaliseAgencyInvoiceBooking(bookingId, bookingContext);
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Opening secure payment...";
    }
    if (message) {
      message.textContent = "Booking request saved. Opening secure Stripe payment...";
      message.dataset.type = "success";
    }

    const result = await createBookingCheckoutSession({
      bookingId,
      bookingContext,
      successUrl: buildPageUrl("/success/", bookingId),
      cancelUrl: buildPageUrl("/cancelled/", bookingId)
    });

    const checkoutUrl = result?.data?.checkoutUrl;
    if (!checkoutUrl) throw new Error("Stripe Checkout URL was not returned.");
    window.location.assign(checkoutUrl);
  } catch (error) {
    console.error("Booking payment finalisation error:", error);
    redirectStarted = false;
    if (message) {
      message.textContent = shouldUseAgencyInvoice(getBookingContext())
        ? "The booking was saved, but the agency invoice account could not be approved. Please pay now or call IronGate on 0481 442 260."
        : "The booking was saved, but secure payment could not open. Please call IronGate on 0481 442 260 or try again.";
      message.dataset.type = "error";
    }
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Continue to Secure Payment";
    }
  }
}

setCustomerFacingCopy();

if (message) {
  const observer = new MutationObserver(() => {
    const bookingId = extractBookingId(message.textContent);
    if (bookingId) redirectToStripeCheckout(bookingId);
  });
  observer.observe(message, { childList: true, characterData: true, subtree: true });
}

if (submitButton) {
  const buttonObserver = new MutationObserver(() => {
    if (!submitButton.disabled && submitButton.textContent.trim() === "Save Booking Test") {
      submitButton.textContent = "Continue to Secure Payment";
    }
  });
  buttonObserver.observe(submitButton, { childList: true, characterData: true, subtree: true });
}
