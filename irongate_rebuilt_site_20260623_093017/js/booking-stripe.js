import "./site-licence.js";
import "./booking-customer-type.js";
import { app } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const form = document.querySelector("#booking-form");
const submitButton = document.querySelector("#booking-submit");
const message = document.querySelector("#booking-message");
const priceNotice = document.querySelector("#booking-price-notice");
const functions = getFunctions(app, "us-central1");
const createBookingCheckoutSession = httpsCallable(functions, "createBookingCheckoutSession");

let redirectStarted = false;

function setCustomerFacingCopy() {
  if (priceNotice) priceNotice.textContent = "Pool Safety Inspection & Certificate — $249";
  if (submitButton && !submitButton.disabled) submitButton.textContent = "Continue to Secure Payment";
}

function getValue(selector) {
  const element = document.querySelector(selector);
  return element ? String(element.value || "").trim() : "";
}

function getChecked(selector) {
  return document.querySelector(selector)?.checked === true;
}

function setMessage(text, type = "") {
  if (!message) return;
  message.textContent = text;
  message.dataset.type = type;
}

function setButtonLoading(isLoading, text = "Opening secure payment...") {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? text : "Continue to Secure Payment";
}

function normaliseAustralianMobile(value) {
  const cleaned = String(value || "").replace(/[\s()-]/g, "");
  if (/^04\d{8}$/.test(cleaned)) return cleaned;
  if (/^\+614\d{8}$/.test(cleaned)) return cleaned;
  if (/^614\d{8}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

function buildPageUrl(path) {
  return new URL(path, window.location.origin).toString();
}

function todayBusinessDateKey() {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isTodayOrPastDateKey(dateKey) {
  return String(dateKey || "") <= todayBusinessDateKey();
}

function selectedSlotDetails() {
  const selectedButton = document.querySelector(".booking-slot-btn.is-selected");
  const slotId = getValue("#preferredTimeSlot") || selectedButton?.dataset?.slotId || "";
  const label = selectedButton?.querySelector("strong")?.textContent?.trim() || slotId;
  const timeRange = selectedButton?.querySelector("span")?.textContent?.trim() || "";
  const parts = timeRange.split(/\s+to\s+/i).map((part) => part.trim());

  return {
    id: slotId,
    label,
    start: parts[0] || "",
    end: parts[1] || ""
  };
}

function selectedDateDisplay(dateKey) {
  const text = document.querySelector("#selected-date-label")?.textContent || "";
  return text.replace(/^Selected date:\s*/i, "").trim() || dateKey;
}

function validateBookingPayload(payload) {
  if (!payload.customerName) return "Please enter your full name.";
  if (!payload.email) return "Please enter your email address.";
  if (!payload.phone) return "Please enter your Australian mobile number.";
  if (!payload.propertyAddress) return "Please enter the inspection property address.";
  if (!payload.propertyAddressSelected) return "Please select the property address from the suggestions.";
  if (!payload.inspectionReason) return "Please select the reason for inspection.";
  if (!payload.poolType) return "Please select the pool type.";
  if (!payload.existingCertificateStatus) return "Please select whether there is an existing pool safety certificate.";
  if (!payload.poolRegisteredStatus) return "Please confirm whether the pool is registered with QBCC.";
  if (!payload.preferredDate) return "Please select an inspection date.";
  if (isTodayOrPastDateKey(payload.preferredDate)) return "Please choose an inspection date from tomorrow onwards.";
  if (!payload.preferredTimeSlot) return "Please select an inspection time.";
  if (!payload.preferredTimeStart || !payload.preferredTimeEnd) return "Please reselect the inspection time slot.";
  if (!payload.isPropertyOwner && !payload.authorisedToBook) return "Please confirm you are the owner or authorised to arrange the inspection.";
  if (payload.animalsOffLeash && !payload.animalsWillBeSecured) return "Please confirm animals will be secured away from the inspection area.";
  if (!payload.nonComplianceAcknowledged) return "Please acknowledge that a certificate can only be issued if compliant.";
  if (!payload.informationAccuracyConfirmed) return "Please confirm the information is accurate.";
  if (!payload.termsAccepted) return "Please accept the website policies before continuing.";
  return "";
}

function collectBookingPayload() {
  const dateKey = getValue("#preferredDate");
  const slot = selectedSlotDetails();
  const isOwner = getChecked("#isPropertyOwner");
  const termsAccepted = getChecked("#termsAccepted");

  return {
    customerName: getValue("#customerName"),
    email: getValue("#email"),
    phone: normaliseAustralianMobile(getValue("#phone")),
    propertyAddress: getValue("#propertyAddress"),
    propertyAddressSelected: getValue("#propertyAddressSelected") === "true",
    propertyPlaceId: getValue("#propertyPlaceId"),

    isPropertyOwner: isOwner,
    authorisedToBook: getChecked("#authorisedToBook"),
    clientType: isOwner ? "Property owner" : "Authorised representative",
    inspectionReason: getValue("#inspectionReason"),
    poolType: getValue("#poolType"),
    existingCertificateStatus: getValue("#existingCertificateStatus"),
    poolRegisteredStatus: getValue("#poolRegisteredStatus"),

    preferredDate: dateKey,
    preferredDateDisplay: selectedDateDisplay(dateKey),
    preferredTimeSlot: slot.id,
    preferredTimeLabel: slot.label,
    preferredTimeStart: slot.start,
    preferredTimeEnd: slot.end,
    preferredTime: slot.label,

    willBeHomeForInspection: getChecked("#willBeHomeForInspection"),
    accessPermissionIfNotHome: getChecked("#accessPermissionIfNotHome"),
    animalsOnProperty: getChecked("#animalsOnProperty"),
    animalsOffLeash: getChecked("#animalsOffLeash"),
    animalsWillBeSecured: getChecked("#animalsWillBeSecured"),
    accessInstructions: getValue("#accessInstructions"),

    hasPoolExemption: getChecked("#hasPoolExemption"),
    minorRepairsContactAccepted: getChecked("#minorRepairsContactAccepted"),
    nonComplianceAcknowledged: getChecked("#nonComplianceAcknowledged"),
    informationAccuracyConfirmed: getChecked("#informationAccuracyConfirmed"),
    notes: getValue("#notes"),
    termsAccepted,
    privacyAccepted: termsAccepted
  };
}

async function handleBackendBookingSubmit(event) {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (redirectStarted) return;
  setMessage("");

  const booking = collectBookingPayload();
  const validationError = validateBookingPayload(booking);
  if (validationError) {
    setMessage(validationError, "error");
    return;
  }

  redirectStarted = true;
  setButtonLoading(true);
  setMessage("Creating your booking and opening secure Stripe payment...", "success");

  try {
    const result = await createBookingCheckoutSession({
      booking,
      successUrl: buildPageUrl("/success/"),
      cancelUrl: buildPageUrl("/cancelled/")
    });

    const checkoutUrl = result?.data?.checkoutUrl;
    if (!checkoutUrl) throw new Error("Stripe Checkout URL was not returned.");

    window.location.assign(checkoutUrl);
  } catch (error) {
    console.error("Backend booking checkout error:", error);
    redirectStarted = false;
    setMessage("We could not create the booking payment. Please refresh and try again, or call IronGate on 0481 442 260.", "error");
    setButtonLoading(false);
  }
}

setCustomerFacingCopy();

if (form) {
  form.addEventListener("submit", handleBackendBookingSubmit, { capture: true });
}

if (submitButton) {
  const buttonObserver = new MutationObserver(() => {
    if (!submitButton.disabled && submitButton.textContent.trim() === "Save Booking Test") {
      submitButton.textContent = "Continue to Secure Payment";
    }
  });
  buttonObserver.observe(submitButton, { childList: true, characterData: true, subtree: true });
}
