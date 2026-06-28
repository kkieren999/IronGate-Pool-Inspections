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

function injectCustomerTypeStyles() {
  if (document.querySelector("#booking-customer-type-styles")) return;

  const style = document.createElement("style");
  style.id = "booking-customer-type-styles";
  style.textContent = `
    #customer-type-section.ig-intake-section {
      position: relative;
      overflow: hidden;
      padding: clamp(22px, 3vw, 30px);
      border: 1px solid rgba(21,158,232,.22);
      border-radius: 28px;
      background:
        radial-gradient(circle at top right, rgba(21,158,232,.15), transparent 34%),
        linear-gradient(135deg, #ffffff 0%, #f5fbff 54%, #f9fcff 100%);
      box-shadow: 0 20px 44px rgba(4,26,55,.08);
    }

    #customer-type-section.ig-intake-section::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 6px;
      background: linear-gradient(180deg, var(--blue), #073b73);
    }

    .ig-intake-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 4px;
    }

    .ig-intake-header h2 {
      font-size: clamp(1.4rem, 3vw, 2rem);
      letter-spacing: -.035em;
    }

    .ig-step-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      color: var(--blue);
      background: #eaf8ff;
      border: 1px solid rgba(21,158,232,.18);
      font-size: .78rem;
      font-weight: 900;
      letter-spacing: .08em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .booking-type-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin-top: 12px;
    }

    .booking-form label.booking-type-card {
      display: grid !important;
      grid-template-columns: auto 1fr;
      gap: 14px !important;
      align-items: flex-start !important;
      padding: 18px !important;
      min-height: 128px;
      border: 1px solid rgba(7,24,52,.10);
      border-radius: 22px;
      background: rgba(255,255,255,.88);
      color: var(--navy);
      cursor: pointer;
      box-shadow: 0 12px 26px rgba(4,26,55,.05);
      transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, background .18s ease;
    }

    .booking-form label.booking-type-card:hover {
      transform: translateY(-2px);
      border-color: rgba(21,158,232,.34);
      box-shadow: 0 18px 36px rgba(4,26,55,.08);
    }

    .booking-type-card.is-selected {
      border-color: rgba(21,158,232,.70) !important;
      background: linear-gradient(135deg, #eef9ff, #ffffff) !important;
      box-shadow: 0 20px 42px rgba(21,158,232,.14) !important;
    }

    .booking-type-card input[type="radio"],
    .agency-payment-card input[type="radio"] {
      appearance: none;
      -webkit-appearance: none;
      width: 24px !important;
      height: 24px !important;
      min-width: 24px;
      margin: 2px 0 0 !important;
      border: 2px solid #b8c7d8;
      border-radius: 999px;
      background: #fff;
      display: inline-grid;
      place-content: center;
      cursor: pointer;
    }

    .booking-type-card input[type="radio"]::before,
    .agency-payment-card input[type="radio"]::before {
      content: "";
      width: 12px;
      height: 12px;
      border-radius: 999px;
      transform: scale(0);
      transition: transform .14s ease;
      background: var(--blue);
    }

    .booking-type-card input[type="radio"]:checked,
    .agency-payment-card input[type="radio"]:checked {
      border-color: var(--blue);
    }

    .booking-type-card input[type="radio"]:checked::before,
    .agency-payment-card input[type="radio"]:checked::before {
      transform: scale(1);
    }

    .booking-type-copy strong {
      display: block;
      color: var(--navy);
      font-size: 1.05rem;
      line-height: 1.2;
    }

    .booking-type-copy span {
      display: block;
      margin-top: 7px;
      color: var(--muted);
      font-weight: 750;
      line-height: 1.45;
    }

    .booking-type-tag {
      display: inline-flex !important;
      width: auto !important;
      margin-top: 12px !important;
      padding: 6px 10px;
      border-radius: 999px;
      color: #073b73 !important;
      background: #edf7ff;
      border: 1px solid rgba(21,158,232,.16);
      font-size: .76rem;
      font-weight: 900 !important;
    }

    #agency-booking-panel.ig-agency-panel {
      padding: 18px;
      border-radius: 24px;
      background:
        radial-gradient(circle at top right, rgba(7,59,115,.12), transparent 34%),
        #ffffff;
      border: 1px solid rgba(21,158,232,.20);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.88);
    }

    #agency-booking-panel .agency-panel-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 14px;
      padding-bottom: 14px;
      border-bottom: 1px solid rgba(7,24,52,.08);
    }

    #agency-booking-panel .agency-panel-head strong {
      display: block;
      color: var(--navy);
      font-size: 1.08rem;
    }

    #agency-booking-panel .agency-panel-head span {
      display: block;
      margin-top: 5px;
      color: var(--muted);
      font-weight: 750;
      line-height: 1.45;
    }

    .agency-code-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      color: #0f8a43;
      background: #eafaf0;
      border: 1px solid rgba(15,138,67,.15);
      font-weight: 900;
      white-space: nowrap;
    }

    .agency-code-card {
      display: grid;
      gap: 14px;
      padding: 16px;
      border-radius: 20px;
      background: #f7fbff;
      border: 1px solid rgba(7,24,52,.08);
    }

    .agency-payment-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .booking-form label.agency-payment-card {
      display: grid !important;
      grid-template-columns: auto 1fr;
      gap: 13px !important;
      align-items: flex-start !important;
      padding: 16px !important;
      border: 1px solid rgba(7,24,52,.10);
      border-radius: 20px;
      background: #fff;
      cursor: pointer;
      transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }

    .booking-form label.agency-payment-card:hover {
      transform: translateY(-1px);
      border-color: rgba(21,158,232,.35);
      box-shadow: 0 14px 30px rgba(4,26,55,.06);
    }

    .agency-payment-card.is-selected {
      border-color: rgba(21,158,232,.65) !important;
      background: #f1fbff !important;
    }

    .agency-payment-card strong {
      display: block;
      color: var(--navy);
      line-height: 1.25;
    }

    .agency-payment-card small {
      display: block;
      color: var(--muted);
      font-weight: 750;
      line-height: 1.4;
      margin-top: 5px;
    }

    .owner-details-agent {
      border-color: rgba(21,158,232,.22) !important;
      background: linear-gradient(135deg, #fff, #f7fbff) !important;
    }

    .owner-details-agent h2::after {
      content: "Agent booking";
      display: inline-flex;
      margin-left: 10px;
      padding: 5px 9px;
      border-radius: 999px;
      color: var(--blue);
      background: #eaf8ff;
      font-size: .68rem;
      font-weight: 900;
      letter-spacing: .06em;
      text-transform: uppercase;
      vertical-align: middle;
    }

    @media (max-width: 780px) {
      .ig-intake-header,
      #agency-booking-panel .agency-panel-head {
        display: grid;
      }
      .booking-type-grid,
      .agency-payment-grid {
        grid-template-columns: 1fr;
      }
      .booking-form label.booking-type-card {
        min-height: auto;
      }
    }
  `;

  document.head.appendChild(style);
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

function updateSelectedCards() {
  const customerType = value("#customerType") || "homeowner";
  document.querySelectorAll(".booking-type-card").forEach((card) => {
    const input = card.querySelector("input[type='radio']");
    card.classList.toggle("is-selected", input?.value === customerType);
  });

  const paymentMethod = selectedPaymentMethod();
  document.querySelectorAll(".agency-payment-card").forEach((card) => {
    const input = card.querySelector("input[type='radio']");
    card.classList.toggle("is-selected", input?.value === paymentMethod);
  });
}

function updateContactSectionCopy(isAgent) {
  const heading = document.querySelector("#contact-details-heading");
  const helper = contactSection?.querySelector(".section-helper");

  if (contactSection) contactSection.classList.toggle("owner-details-agent", isAgent);
  if (heading) heading.textContent = isAgent ? "Owner details" : "Homeowner contact details";
  if (helper) {
    helper.textContent = isAgent
      ? "Enter the owner contact details for the property. Your agency details are pulled from the partner code we have on file."
      : "We will use these homeowner details to confirm the booking and contact you if access details are unclear.";
  }

  updateLabelText("#customerName", isAgent ? "Owner full name" : "Full name");
  updateLabelText("#email", isAgent ? "Owner email address" : "Email address");
  updateLabelText("#phone", isAgent ? "Owner mobile number" : "Australian mobile number");
}

function toggleCustomerTypeFields() {
  const selectedRadio = document.querySelector('input[name="customerTypeChoice"]:checked');
  const hiddenCustomerType = document.querySelector("#customerType");
  if (selectedRadio && hiddenCustomerType) hiddenCustomerType.value = selectedRadio.value;

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
  updateSelectedCards();
  collectBookingContext();
}

function injectCustomerTypePanel() {
  if (!form || !contactSection || document.querySelector("#customer-type-section")) return;

  injectCustomerTypeStyles();

  const section = document.createElement("section");
  section.className = "form-section ig-intake-section";
  section.id = "customer-type-section";
  section.setAttribute("aria-labelledby", "customer-type-heading");
  section.innerHTML = `
    <div class="ig-intake-header">
      <div>
        <h2 id="customer-type-heading">Who is booking?</h2>
        <p class="section-helper">This helps us show the right details and payment options for the booking.</p>
      </div>
      <span class="ig-step-pill">Step 1</span>
    </div>

    <input type="hidden" id="customerType" value="homeowner" />

    <div class="booking-type-grid" role="radiogroup" aria-label="Customer type">
      <label class="booking-type-card is-selected">
        <input type="radio" name="customerTypeChoice" value="homeowner" checked />
        <span class="booking-type-copy">
          <strong>Homeowner / property owner</strong>
          <span>I am booking the pool safety inspection for my own property.</span>
          <span class="booking-type-tag">Pay securely online</span>
        </span>
      </label>
      <label class="booking-type-card">
        <input type="radio" name="customerTypeChoice" value="agent" />
        <span class="booking-type-copy">
          <strong>Agent / property manager</strong>
          <span>I am booking on behalf of an owner using an agency partner code.</span>
          <span class="booking-type-tag">Partner or invoice options</span>
        </span>
      </label>
    </div>

    <div class="conditional-panel ig-agency-panel" id="agency-booking-panel" hidden>
      <div class="agency-panel-head">
        <div>
          <strong>Agency booking details</strong>
          <span>Enter the agency partner code. We keep your agency contact and account details on file in the admin console.</span>
        </div>
        <span class="agency-code-badge">Partner code</span>
      </div>

      <div class="agency-code-card">
        <div class="field-grid">
          <label class="full-width">
            Agency partner code
            <input type="text" id="agencyPartnerCode" autocomplete="off" placeholder="Example: BIGHOUSE" />
            <span class="field-note">This is different from the Stripe promo code. Example: BIGHOUSE for invoice access, BIGHOUSE25 for a pay-now discount.</span>
          </label>
          <label class="full-width">
            Agency job / PO reference, optional
            <input type="text" id="agencyJobReference" autocomplete="off" placeholder="PM job number, owner ref, listing ref" />
          </label>
        </div>
      </div>

      <div class="agency-payment-grid">
        <label class="agency-payment-card is-selected">
          <input type="radio" name="agencyPaymentMethod" value="pay_now" checked />
          <span>
            <strong>Pay now</strong>
            <small>Use card, Apple Pay, Google Pay, PayTo or a Stripe promotion code at checkout.</small>
          </span>
        </label>
        <label class="agency-payment-card">
          <input type="radio" name="agencyPaymentMethod" value="agency_invoice" />
          <span>
            <strong>Approved invoice account</strong>
            <small>Only active agency partner codes approved in the admin console can use this.</small>
          </span>
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