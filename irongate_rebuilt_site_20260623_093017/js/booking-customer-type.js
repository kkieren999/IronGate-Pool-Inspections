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

function injectCalendarHeaderStyles() {
  if (document.querySelector("#booking-calendar-header-fix")) return;

  const style = document.createElement("style");
  style.id = "booking-calendar-header-fix";
  style.textContent = `
    .booking-calendar {
      display: grid;
      gap: 14px;
      padding: 16px;
      border-radius: 22px;
      background: #f9fbfe;
      border: 1px solid rgba(7, 24, 52, .08);
    }

    .calendar-header-row {
      display: grid !important;
      grid-template-columns: 46px minmax(0, 1fr) 46px;
      align-items: center;
      gap: 12px;
      width: 100%;
    }

    .calendar-header-row h3,
    #calendar-title {
      margin: 0 !important;
      text-align: center;
      color: var(--navy);
      font-size: clamp(1.15rem, 3vw, 1.45rem);
      font-weight: 900;
      letter-spacing: -.025em;
      line-height: 1.15;
      white-space: nowrap;
    }

    .calendar-nav-btn {
      width: 46px !important;
      min-width: 46px !important;
      height: 46px !important;
      min-height: 46px !important;
      padding: 0 !important;
      display: inline-grid !important;
      place-items: center !important;
      border: 1px solid rgba(21, 158, 232, .22) !important;
      border-radius: 999px !important;
      background: #ffffff !important;
      color: var(--navy) !important;
      box-shadow: 0 10px 22px rgba(4, 26, 55, .07);
      font-size: 1.9rem !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      cursor: pointer;
    }

    .calendar-nav-btn:hover:not(:disabled),
    .calendar-nav-btn:focus-visible:not(:disabled) {
      background: #eaf8ff !important;
      border-color: rgba(21, 158, 232, .48) !important;
      color: var(--blue) !important;
      transform: translateY(-1px);
    }

    .calendar-nav-btn:disabled {
      opacity: .42;
      cursor: not-allowed;
      box-shadow: none;
    }

    @media (max-width: 580px) {
      .calendar-header-row {
        grid-template-columns: 40px minmax(0, 1fr) 40px;
        gap: 8px;
      }

      .calendar-nav-btn {
        width: 40px !important;
        min-width: 40px !important;
        height: 40px !important;
        min-height: 40px !important;
        font-size: 1.55rem !important;
      }
    }
  `;

  document.head.appendChild(style);
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
injectCalendarHeaderStyles();
setHomeownerContactCopy();
hidePublicAgentBookingUi();
collectBookingContext();

if (form) {
  form.addEventListener("input", collectBookingContext, true);
  form.addEventListener("submit", collectBookingContext, true);
}
