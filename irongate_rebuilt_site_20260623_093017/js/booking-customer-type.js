const form = document.querySelector("#booking-form");
const contactSection = document.querySelector("#contact-details-heading")?.closest(".form-section");

window.ironGateBookingContext = {
  customerType: "homeowner",
  bookingRole: "Homeowner",
  requestedPaymentMethod: "pay_now"
};

function updateLabelText(inputSelector, text) {
  const input = document.querySelector(inputSelector);
  const label = input?.closest("label");
  if (!label) return;

  const textNode = [...label.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) textNode.textContent = `\n                  ${text}\n                  `;
}

function removeInternalBookingNote() {
  document.querySelectorAll(".booking-note").forEach((note) => {
    if (/availability manager/i.test(note.textContent || "")) note.remove();
  });
}

function setHomeownerContactCopy() {
  const heading = document.querySelector("#contact-details-heading");
  const helper = contactSection?.querySelector(".section-helper");

  if (heading) heading.textContent = "Homeowner contact details";
  if (helper) {
    helper.textContent = "We will use these homeowner details to confirm the booking and contact you if access details are unclear.";
  }

  updateLabelText("#customerName", "Full name");
  updateLabelText("#email", "Email address");
  updateLabelText("#phone", "Australian mobile number");
}

function collectBookingContext() {
  window.ironGateBookingContext = {
    customerType: "homeowner",
    bookingRole: "Homeowner",
    agencyName: "",
    agentName: "",
    agentEmail: "",
    agentPhone: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    agencyJobReference: "",
    agencyPartnerCode: "",
    requestedPaymentMethod: "pay_now"
  };
  return window.ironGateBookingContext;
}

function hidePublicAgentBookingUi() {
  document.querySelectorAll("#customer-type-section, #agency-booking-panel").forEach((element) => {
    element.hidden = true;
    element.style.display = "none";
  });

  document.querySelectorAll("option[value='agent'], input[value='agent']").forEach((element) => {
    const wrapper = element.closest("label, option");
    if (wrapper) wrapper.hidden = true;
  });
}

removeInternalBookingNote();
setHomeownerContactCopy();
hidePublicAgentBookingUi();
collectBookingContext();

if (form) {
  form.addEventListener("input", collectBookingContext, true);
  form.addEventListener("submit", collectBookingContext, true);
}
