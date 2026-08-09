import "./site-licence.js";
import "./booking-customer-type.js";
import { app, db } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { doc, getDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form = document.querySelector("#booking-form");
const submitButton = document.querySelector("#booking-submit");
const message = document.querySelector("#booking-message");
const priceNotice = document.querySelector("#booking-price-notice");
const functions = getFunctions(app, "us-central1");
const createBookingCheckoutSession = httpsCallable(functions, "createBookingCheckoutSession");
const privateInviteToken = String(new URLSearchParams(window.location.search).get("invite") || "").trim();

let redirectStarted = false;
let privateInvite = null;
let privateInviteObserver = null;

function setCustomerFacingCopy() {
  if (priceNotice) priceNotice.textContent = "Pool Safety Inspection & Certificate — $149";
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
  if (!privateInvite && isTodayOrPastDateKey(payload.preferredDate)) return "Please choose an inspection date from tomorrow onwards.";
  if (!payload.preferredTimeSlot) return "Please select an inspection time.";
  if (!payload.preferredTimeStart || !payload.preferredTimeEnd) return "Please reselect the inspection time slot.";
  if (!payload.isPropertyOwner && !payload.authorisedToBook) return "Please confirm you are the owner or authorised to arrange the inspection.";
  if (payload.animalsOffLeash && !payload.animalsWillBeSecured) return "Please confirm animals will be secured away from the inspection area.";
  if (!payload.nonComplianceAcknowledged) return "Please acknowledge that a certificate can only be issued if compliant.";
  if (!payload.informationAccuracyConfirmed) return "Please confirm the information is accurate.";
  if (!payload.termsAccepted) return "Please accept the website policies before continuing.";

  if (privateInvite) {
    if (payload.preferredDate !== privateInvite.date) return "This private link is only valid for its reserved date.";
    if (payload.preferredTimeSlot !== privateInvite.slotId) return "This private link is only valid for its reserved time.";
    if (payload.preferredTimeStart !== privateInvite.start || payload.preferredTimeEnd !== privateInvite.end) {
      return "The private booking time has changed. Please reopen the link.";
    }
  }

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

function privateCustomerUpdate(booking) {
  return {
    customerName: booking.customerName,
    email: booking.email,
    phone: booking.phone,
    propertyAddress: booking.propertyAddress,
    propertyAddressSelected: booking.propertyAddressSelected,
    propertyPlaceId: booking.propertyPlaceId,
    isPropertyOwner: booking.isPropertyOwner,
    authorisedToBook: booking.authorisedToBook,
    clientType: booking.clientType,
    inspectionReason: booking.inspectionReason,
    poolType: booking.poolType,
    existingCertificateStatus: booking.existingCertificateStatus,
    poolRegisteredStatus: booking.poolRegisteredStatus,
    willBeHomeForInspection: booking.willBeHomeForInspection,
    accessPermissionIfNotHome: booking.accessPermissionIfNotHome,
    animalsOnProperty: booking.animalsOnProperty,
    animalsOffLeash: booking.animalsOffLeash,
    animalsWillBeSecured: booking.animalsWillBeSecured,
    accessInstructions: booking.accessInstructions,
    hasPoolExemption: booking.hasPoolExemption,
    minorRepairsContactAccepted: booking.minorRepairsContactAccepted,
    nonComplianceAcknowledged: booking.nonComplianceAcknowledged,
    informationAccuracyConfirmed: booking.informationAccuracyConfirmed,
    notes: booking.notes,
    termsAccepted: booking.termsAccepted,
    privacyAccepted: booking.privacyAccepted,
    privateInviteProof: privateInviteToken,
    privateInviteSubmittedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
}

function inviteExpired(invite) {
  const expiresAt = invite?.expiresAt?.toDate?.();
  return !expiresAt || expiresAt <= new Date();
}

function applyPrivateInviteSelection() {
  if (!privateInvite) return;

  const dateInput = document.querySelector("#preferredDate");
  const slotInput = document.querySelector("#preferredTimeSlot");
  const dateLabel = document.querySelector("#selected-date-label");
  const slotLabel = document.querySelector("#selected-slot-label");
  const slotGrid = document.querySelector("#booking-slot-grid");
  const calendarGrid = document.querySelector("#calendar-grid");
  const calendarPrev = document.querySelector("#calendar-prev");
  const calendarNext = document.querySelector("#calendar-next");
  const calendarTitle = document.querySelector("#calendar-title");
  const calendarSection = document.querySelector(".form-section[aria-labelledby='calendar-heading']");

  if (dateInput) dateInput.value = privateInvite.date;
  if (slotInput) slotInput.value = privateInvite.slotId;
  if (dateLabel) {
    dateLabel.textContent = `Selected date: ${privateInvite.dateDisplay || privateInvite.date}`;
    dateLabel.dataset.type = "selected";
  }
  if (slotLabel) {
    slotLabel.textContent = `Selected time: ${privateInvite.label}`;
    slotLabel.dataset.type = "selected";
  }
  if (slotGrid && !slotGrid.querySelector("[data-private-invite-slot='true']")) {
    slotGrid.innerHTML = `
      <button type="button" class="booking-slot-btn is-selected" data-slot-id="${privateInvite.slotId}" data-private-invite-slot="true" aria-pressed="true" disabled>
        <strong>${privateInvite.label}</strong><span>${privateInvite.start} to ${privateInvite.end}</span>
      </button>
    `;
  }
  if (calendarGrid) {
    calendarGrid.style.pointerEvents = "none";
    calendarGrid.style.opacity = ".45";
    calendarGrid.setAttribute("aria-disabled", "true");
  }
  if (calendarPrev) calendarPrev.disabled = true;
  if (calendarNext) calendarNext.disabled = true;
  if (calendarTitle) calendarTitle.textContent = "Private reserved session";

  if (calendarSection && !document.querySelector("#private-invite-banner")) {
    const banner = document.createElement("div");
    banner.id = "private-invite-banner";
    banner.className = "intake-alert";
    banner.style.background = "#eef9ff";
    banner.style.borderColor = "rgba(21,158,232,.28)";
    banner.style.color = "#075985";
    banner.innerHTML = `<strong>Private booking invitation</strong><br>This link reserves <strong>${privateInvite.dateDisplay || privateInvite.date}</strong> at <strong>${privateInvite.label}</strong>. This session is not available on the public calendar.`;
    calendarSection.insertBefore(banner, calendarSection.children[2] || null);
    const helper = calendarSection.querySelector(".section-helper");
    if (helper) helper.textContent = "Your inspection date and time are fixed by this private invitation. Complete the details below and continue to secure payment.";
  }
}

function observePrivateSlotDisplay() {
  const slotGrid = document.querySelector("#booking-slot-grid");
  if (!slotGrid || privateInviteObserver) return;
  privateInviteObserver = new MutationObserver(() => {
    if (privateInvite && !slotGrid.querySelector("[data-private-invite-slot='true']")) {
      applyPrivateInviteSelection();
    }
  });
  privateInviteObserver.observe(slotGrid, { childList: true, subtree: true });
}

async function loadPrivateInvite() {
  if (!privateInviteToken) return;

  setButtonLoading(true, "Loading private session...");
  setMessage("Checking your private booking invitation…", "");

  try {
    const snap = await getDoc(doc(db, "privateBookingInvites", privateInviteToken));
    if (!snap.exists()) throw new Error("This private booking link is invalid.");
    const invite = snap.data() || {};
    if (invite.status !== "active") throw new Error("This private booking link has already been used or cancelled.");
    if (inviteExpired(invite)) throw new Error("This private booking link has expired. Please contact IronGate for a new link.");
    if (invite.date !== todayBusinessDateKey()) throw new Error("This private booking link is no longer valid for today.");
    if (!invite.bookingId || !invite.slotId || !invite.start || !invite.end) throw new Error("This private booking link is incomplete.");

    privateInvite = { token: privateInviteToken, ...invite };
    applyPrivateInviteSelection();
    observePrivateSlotDisplay();
    setMessage(`Private session reserved: ${privateInvite.dateDisplay || privateInvite.date}, ${privateInvite.label}. Complete the form to continue to payment.`, "success");
    setButtonLoading(false);
  } catch (error) {
    console.error("Private booking invite error:", error);
    privateInvite = null;
    setMessage(error.message || "This private booking link is unavailable.", "error");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Private link unavailable";
    }
  }
}

async function handlePrivateBookingCheckout(booking) {
  const bookingRef = doc(db, "bookings", privateInvite.bookingId);
  const inviteRef = doc(db, "privateBookingInvites", privateInviteToken);

  await updateDoc(bookingRef, privateCustomerUpdate(booking));

  const result = await createBookingCheckoutSession({
    bookingId: privateInvite.bookingId,
    successUrl: buildPageUrl("/success/"),
    cancelUrl: buildPageUrl("/cancelled/")
  });

  const checkoutUrl = result?.data?.checkoutUrl;
  if (!checkoutUrl) throw new Error("Stripe Checkout URL was not returned.");

  try {
    await updateDoc(inviteRef, {
      status: "submitted",
      submittedAt: serverTimestamp(),
      submittedEmail: booking.email
    });
  } catch (error) {
    console.warn("Checkout was created but private invite status could not be updated:", error);
  }

  return checkoutUrl;
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
  setMessage(privateInvite ? "Confirming your private session and opening secure Stripe payment..." : "Creating your booking and opening secure Stripe payment...", "success");

  try {
    let checkoutUrl = "";

    if (privateInvite) {
      checkoutUrl = await handlePrivateBookingCheckout(booking);
    } else {
      const result = await createBookingCheckoutSession({
        booking,
        successUrl: buildPageUrl("/success/"),
        cancelUrl: buildPageUrl("/cancelled/")
      });
      checkoutUrl = result?.data?.checkoutUrl || "";
    }

    if (!checkoutUrl) throw new Error("Stripe Checkout URL was not returned.");
    window.location.assign(checkoutUrl);
  } catch (error) {
    console.error("Backend booking checkout error:", error);
    redirectStarted = false;
    setMessage(privateInvite
      ? "We could not open payment for this private session. Please try again, or call IronGate on 0481 442 260."
      : "We could not create the booking payment. Please refresh and try again, or call IronGate on 0481 442 260.", "error");
    setButtonLoading(false);
    if (privateInvite) applyPrivateInviteSelection();
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

if (privateInviteToken) {
  loadPrivateInvite();
}
