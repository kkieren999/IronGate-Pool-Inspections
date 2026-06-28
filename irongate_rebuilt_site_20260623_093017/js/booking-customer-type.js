const form = document.querySelector("#booking-form");
const contactSection = document.querySelector("#contact-details-heading")?.closest(".form-section");

window.ironGateBookingContext = {
  customerType: "homeowner",
  requestedPaymentMethod: "pay_now"
};

function value(id) {
  return document.querySelector(id)?.value?.trim() || "";
}

function selectedPaymentMethod() {
  return document.querySelector('input[name="agencyPaymentMethod"]:checked')?.value || "pay_now";
}

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

function collectBookingContext() {
  const customerType = value("#customerType") || "homeowner";
  const isAgent = customerType === "agent";
  const context = {
    customerType,
    bookingRole: isAgent ? "Agent / property manager" : "Homeowner",
    agencyName: "",
    agentName: "",
    agentEmail: "",
    agentPhone: "",
    ownerName: isAgent ? value("#customerName") : "",
    ownerEmail: isAgent ? value("#email") : "",
    ownerPhone: isAgent ? value("#phone") : "",
    agencyJobReference: value("#agencyJobReference"),
    agencyPartnerCode: value("#agencyPartnerCode"),
    requestedPaymentMethod: isAgent ? selectedPaymentMethod() : "pay_now"
  };

  window.ironGateBookingContext = context;
  return context;
}

function setRequired(element, required) {
  if (!element) return;
  if (required) element.setAttribute("required", "required");
  else element.removeAttribute("required");
}

function syncOwnerAuthority(isAgent) {
  const ownerCheckbox = document.querySelector("#isPropertyOwner");
  const authorisedCheckbox = document.querySelector("#authorisedToBook");

  if (isAgent) {
    if (ownerCheckbox) ownerCheckbox.checked = false;
    if (authorisedCheckbox) authorisedCheckbox.checked = true;
  }
}

function updateContactSectionCopy(isAgent) {
  const heading = document.querySelector("#contact-details-heading");
  const helper = contactSection?.querySelector(".section-helper");

  if (heading) heading.textContent = isAgent ? "Owner details" : "Homeowner contact details";
  if (helper) {
    helper.textContent = isAgent
      ? "Enter the property owner or primary owner contact details. Your agency details are linked from the agency partner code."
      : "We will use these homeowner details to confirm the booking and contact you if access details are unclear.";
  }

  updateLabelText("#customerName", isAgent ? "Owner full name" : "Full name");
  updateLabelText("#email", isAgent ? "Owner email address" : "Email address");
  updateLabelText("#phone", isAgent ? "Owner mobile number" : "Australian mobile number");
}

function toggleCustomerTypeFields() {
  const customerType = value("#customerType") || "homeowner";
  const agencyPanel = document.querySelector("#agency-booking-panel");
  const isAgent = customerType === "agent";

  if (agencyPanel) {
    agencyPanel.hidden = !isAgent;
    agencyPanel.classList.toggle("is-visible", isAgent);
  }

  const agencyCode = document.querySelector("#agencyPartnerCode");
  setRequired(agencyCode, isAgent);
  syncOwnerAuthority(isAgent);
  updateContactSectionCopy(isAgent);
  collectBookingContext();
}

function injectCustomerTypePanel() {
  if (!form || !contactSection || document.querySelector("#customer-type-section")) return;

  const section = document.createElement("section");
  section.className = "form-section";
  section.id = "customer-type-section";
  section.setAttribute("aria-labelledby", "customer-type-heading");
  section.innerHTML = `
    <h2 id="customer-type-heading">Who is booking?</h2>
    <p class="section-helper">Choose whether this booking is being made by the homeowner or by an approved agency partner.</p>
    <div class="field-grid">
      <label class="full-width">
        Customer type
        <select id="customerType" required>
          <option value="homeowner">Homeowner / property owner</option>
          <option value="agent">Agent / property manager booking for an owner</option>
        </select>
      </label>
    </div>

    <div class="conditional-panel" id="agency-booking-panel" hidden>
      <div class="field-grid">
        <label class="full-width">
          Agency partner code
          <input type="text" id="agencyPartnerCode" autocomplete="off" placeholder="Example: BIGHOUSE" />
          <span class="field-note">Use the agency partner code we have given your office. The agency details are kept on file in the admin console.</span>
        </label>
        <label class="full-width">
          Agency job / PO reference, optional
          <input type="text" id="agencyJobReference" autocomplete="off" placeholder="PM job number, owner ref, listing ref" />
        </label>
      </div>

      <div class="option-stack">
        <label class="option-card">
          <input type="radio" name="agencyPaymentMethod" value="pay_now" checked />
          <span>Pay now by card, Apple Pay, Google Pay, PayTo or promotion code.<small>Use the Stripe promotion code at checkout if your agency has one.</small></span>
        </label>
        <label class="option-card">
          <input type="radio" name="agencyPaymentMethod" value="agency_invoice" />
          <span>Use approved agency invoice account.<small>This only works for active agency partner codes approved in the admin console.</small></span>
        </label>
      </div>
    </div>
  `;

  contactSection.insertAdjacentElement("beforebegin", section);

  section.addEventListener("input", toggleCustomerTypeFields);
  section.addEventListener("change", toggleCustomerTypeFields);
  form.addEventListener("input", collectBookingContext, true);
  form.addEventListener("submit", collectBookingContext, true);
  removeInternalBookingNote();
  toggleCustomerTypeFields();
}

removeInternalBookingNote();
injectCustomerTypePanel();