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

function collectBookingContext() {
  const customerType = value("#customerType") || "homeowner";
  const context = {
    customerType,
    bookingRole: customerType === "agent" ? "Agent / property manager" : "Homeowner",
    agencyName: value("#agencyName"),
    agentName: value("#agentName"),
    agentEmail: value("#agentEmail"),
    agentPhone: value("#agentPhone"),
    ownerName: value("#ownerName"),
    ownerEmail: value("#ownerEmail"),
    ownerPhone: value("#ownerPhone"),
    agencyJobReference: value("#agencyJobReference"),
    agencyPartnerCode: value("#agencyPartnerCode"),
    requestedPaymentMethod: customerType === "agent" ? selectedPaymentMethod() : "pay_now"
  };

  window.ironGateBookingContext = context;
  return context;
}

function setRequired(element, required) {
  if (!element) return;
  if (required) element.setAttribute("required", "required");
  else element.removeAttribute("required");
}

function toggleCustomerTypeFields() {
  const customerType = value("#customerType") || "homeowner";
  const agencyPanel = document.querySelector("#agency-booking-panel");
  const isAgent = customerType === "agent";

  if (agencyPanel) agencyPanel.hidden = !isAgent;

  ["#agencyName", "#agentName"].forEach((selector) => setRequired(document.querySelector(selector), isAgent));

  const agencyCode = document.querySelector("#agencyPartnerCode");
  const invoiceSelected = selectedPaymentMethod() === "agency_invoice";
  setRequired(agencyCode, isAgent && invoiceSelected);

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
    <p class="section-helper">Homeowners pay upfront. Agents can pay upfront with a promotion code, or approved agency partners can request invoice terms.</p>
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
        <label>
          Agency name
          <input type="text" id="agencyName" autocomplete="organization" placeholder="Example: BigHouse Agency" />
        </label>
        <label>
          Agent name
          <input type="text" id="agentName" autocomplete="name" />
        </label>
        <label>
          Agent email
          <input type="email" id="agentEmail" autocomplete="email" inputmode="email" />
        </label>
        <label>
          Agent phone
          <input type="tel" id="agentPhone" autocomplete="tel" inputmode="tel" />
        </label>
        <label>
          Owner name
          <input type="text" id="ownerName" autocomplete="off" />
        </label>
        <label>
          Owner email, optional
          <input type="email" id="ownerEmail" autocomplete="off" inputmode="email" />
        </label>
        <label>
          Owner phone, optional
          <input type="tel" id="ownerPhone" autocomplete="off" inputmode="tel" />
        </label>
        <label>
          Agency job / PO reference, optional
          <input type="text" id="agencyJobReference" autocomplete="off" placeholder="PM job number, owner ref, listing ref" />
        </label>
        <label class="full-width">
          Agency partner code
          <input type="text" id="agencyPartnerCode" autocomplete="off" placeholder="Example: BIGHOUSE" />
          <span class="field-note">Use your agency partner code for invoice terms. Use Stripe promotion codes such as BIGHOUSE25 at checkout for pay-now discounts.</span>
        </label>
      </div>

      <div class="option-stack">
        <label class="option-card">
          <input type="radio" name="agencyPaymentMethod" value="pay_now" checked />
          <span>Pay now by card, Apple Pay, Google Pay, PayTo or promotion code.<small>Best for new agents and one-off bookings.</small></span>
        </label>
        <label class="option-card">
          <input type="radio" name="agencyPaymentMethod" value="agency_invoice" />
          <span>Use approved agency invoice account.<small>Only approved partner codes can use this. Others will be asked to pay now.</small></span>
        </label>
      </div>
    </div>
  `;

  contactSection.insertAdjacentElement("afterend", section);

  section.addEventListener("input", toggleCustomerTypeFields);
  section.addEventListener("change", toggleCustomerTypeFields);
  form.addEventListener("submit", collectBookingContext, true);
  toggleCustomerTypeFields();
}

injectCustomerTypePanel();
