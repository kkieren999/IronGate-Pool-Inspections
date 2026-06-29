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

function injectBookingCalmStyles() {
  if (document.querySelector("#booking-calm-rebuild-styles")) return;

  const style = document.createElement("style");
  style.id = "booking-calm-rebuild-styles";
  style.textContent = `
    .booking-form-shell {
      counter-reset: bookingStep;
    }

    .booking-form-shell > .form-section {
      position: relative;
      overflow: hidden;
      padding: clamp(20px, 3vw, 28px) !important;
      border-radius: 28px !important;
      border-color: rgba(7, 24, 52, .075) !important;
      box-shadow: 0 14px 34px rgba(4, 26, 55, .055);
    }

    .booking-form-shell > .form-section::before {
      counter-increment: bookingStep;
      content: counter(bookingStep);
      position: absolute;
      top: 22px;
      right: 22px;
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      color: var(--blue);
      background: #eaf8ff;
      border: 1px solid rgba(21,158,232,.18);
      font-size: .82rem;
      font-weight: 900;
    }

    .booking-form-shell > .form-section h2 {
      padding-right: 42px;
      font-size: clamp(1.25rem, 2.4vw, 1.55rem) !important;
      letter-spacing: -.025em;
    }

    .property-check-summary,
    .clean-choice-group,
    .final-confirmation-stack {
      display: grid;
      gap: 12px;
    }

    .property-check-summary {
      padding: 15px;
      border-radius: 20px;
      background: #f7fbff;
      border: 1px solid rgba(7,24,52,.07);
    }

    .booking-soft-note {
      margin: 0;
      color: var(--muted);
      font-size: .92rem;
      font-weight: 750;
      line-height: 1.55;
    }

    .optional-property-details {
      margin-top: 2px;
      border: 1px solid rgba(7,24,52,.08);
      border-radius: 20px;
      background: #fbfdff;
      overflow: hidden;
    }

    .optional-property-details summary {
      list-style: none;
      cursor: pointer;
      padding: 16px 18px;
      color: var(--navy);
      font-weight: 900;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .optional-property-details summary::-webkit-details-marker {
      display: none;
    }

    .optional-property-details summary::after {
      content: "+";
      width: 28px;
      height: 28px;
      display: grid;
      place-items: center;
      border-radius: 999px;
      background: #eaf8ff;
      color: var(--blue);
      font-size: 1.2rem;
      line-height: 1;
    }

    .optional-property-details[open] summary::after {
      content: "–";
    }

    .optional-property-details .optional-details-body {
      display: grid;
      gap: 14px;
      padding: 0 18px 18px;
    }

    .optional-property-details .section-helper {
      margin: 0 !important;
    }

    .clean-choice-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .clean-choice-grid.clean-choice-grid--three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .booking-form label.clean-choice-card {
      display: grid !important;
      grid-template-columns: auto 1fr;
      align-items: flex-start !important;
      gap: 12px !important;
      padding: 15px 16px !important;
      min-height: 74px;
      border: 1px solid rgba(7,24,52,.10);
      border-radius: 18px;
      background: #f9fbfe;
      color: var(--navy);
      cursor: pointer;
      transition: transform .18s ease, border-color .18s ease, background .18s ease, box-shadow .18s ease;
    }

    .booking-form label.clean-choice-card:hover {
      transform: translateY(-1px);
      border-color: rgba(21,158,232,.35);
      background: #f4fbff;
      box-shadow: 0 10px 22px rgba(4,26,55,.06);
    }

    .clean-choice-card.is-selected {
      border-color: rgba(21,158,232,.60) !important;
      background: #eef9ff !important;
      box-shadow: 0 13px 28px rgba(21,158,232,.12) !important;
    }

    .clean-choice-card input[type="radio"],
    .clean-choice-card input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 22px !important;
      height: 22px !important;
      min-width: 22px;
      margin: 1px 0 0 !important;
      border: 2px solid #b8c7d8;
      border-radius: 999px;
      background: #fff;
      display: inline-grid;
      place-content: center;
      cursor: pointer;
    }

    .clean-choice-card input[type="checkbox"] {
      border-radius: 7px;
    }

    .clean-choice-card input[type="radio"]::before,
    .clean-choice-card input[type="checkbox"]::before {
      content: "";
      width: 10px;
      height: 10px;
      transform: scale(0);
      transition: transform .13s ease;
      background: var(--blue);
    }

    .clean-choice-card input[type="radio"]::before {
      border-radius: 999px;
    }

    .clean-choice-card input[type="checkbox"]::before {
      width: 11px;
      height: 11px;
      background: #fff;
      clip-path: polygon(14% 44%, 0 65%, 42% 100%, 100% 20%, 82% 4%, 38% 64%);
    }

    .clean-choice-card input:checked {
      border-color: var(--blue);
    }

    .clean-choice-card input[type="checkbox"]:checked {
      background: var(--blue);
    }

    .clean-choice-card input:checked::before {
      transform: scale(1);
    }

    .clean-choice-card strong,
    .clean-choice-card span > strong {
      display: block;
      color: var(--navy);
      font-weight: 900;
      line-height: 1.25;
    }

    .clean-choice-card small {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-weight: 750;
      line-height: 1.4;
    }

    .hidden-booking-controls {
      display: none !important;
    }

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

    .pool-register-panel {
      margin-top: 14px !important;
      border-radius: 20px !important;
      box-shadow: none !important;
    }

    .pool-register-panel[data-status="not_found"],
    .pool-register-panel[data-status="manual_required"] {
      background: #fffaf0 !important;
      border-color: rgba(234, 88, 12, .22) !important;
    }

    .pool-register-panel[data-status="not_found"] .pool-register-icon,
    .pool-register-panel[data-status="manual_required"] .pool-register-icon {
      background: #ea580c !important;
    }

    .pool-register-actions .btn,
    .pool-register-actions a,
    .pool-register-actions button {
      min-height: 44px !important;
      width: auto !important;
      padding: 0 16px !important;
      font-size: .92rem !important;
    }

    #exemption-upload-panel.is-visible,
    #animal-restraint-panel.is-visible {
      margin-top: 12px;
      display: grid !important;
      gap: 12px;
    }

    .final-confirmation-stack .clean-choice-card {
      min-height: auto !important;
    }

    @media (max-width: 780px) {
      .clean-choice-grid,
      .clean-choice-grid.clean-choice-grid--three {
        grid-template-columns: 1fr;
      }
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

function removeSelectRequiredAndSetDefault(selector, fallback = "") {
  const select = document.querySelector(selector);
  if (!select) return null;
  select.removeAttribute("required");
  if (fallback && !select.value) select.value = fallback;
  return select;
}

function buildCleanChoiceCard({ name, value, title, helper, checked = false, type = "radio", id = "" }) {
  const label = document.createElement("label");
  label.className = "clean-choice-card";
  label.innerHTML = `
    <input ${id ? `id="${id}"` : ""} type="${type}" name="${name}" value="${value}" ${checked ? "checked" : ""} />
    <span><strong>${title}</strong>${helper ? `<small>${helper}</small>` : ""}</span>
  `;
  return label;
}

function updateSelectedChoiceCards(root = document) {
  root.querySelectorAll(".clean-choice-card").forEach((card) => {
    const input = card.querySelector("input");
    card.classList.toggle("is-selected", input?.checked === true);
  });
}

function rebuildPropertySection() {
  const propertySection = document.querySelector('[aria-labelledby="property-details-heading"]');
  if (!propertySection || propertySection.dataset.rebuilt === "true") return;
  propertySection.dataset.rebuilt = "true";

  const heading = document.querySelector("#property-details-heading");
  if (heading) heading.textContent = "Property and pool checks";

  const addressLabel = propertySection.querySelector(".address-field-wrap");
  if (addressLabel) {
    const note = document.createElement("p");
    note.className = "booking-soft-note";
    note.textContent = "After you select the address, we automatically check the Queensland pool register. If there is no automatic match, you can still continue if there is a pool at the property.";
    addressLabel.insertAdjacentElement("afterend", note);
  }

  const poolRegisteredSelect = removeSelectRequiredAndSetDefault("#poolRegisteredStatus", "Unsure");
  poolRegisteredSelect?.closest("label")?.remove();

  const optionalSelects = [
    removeSelectRequiredAndSetDefault("#inspectionReason"),
    removeSelectRequiredAndSetDefault("#poolType", "Unsure"),
    removeSelectRequiredAndSetDefault("#existingCertificateStatus", "Unsure")
  ].filter(Boolean);

  if (optionalSelects.length) {
    const details = document.createElement("details");
    details.className = "optional-property-details";
    details.innerHTML = `
      <summary>Optional property details</summary>
      <div class="optional-details-body">
        <p class="section-helper">These details can help us prepare, but you can leave them blank if you are not sure.</p>
        <div class="field-grid compact-field-grid"></div>
      </div>
    `;
    const grid = details.querySelector(".field-grid");
    optionalSelects.forEach((select) => {
      const label = select.closest("label");
      if (label) grid.appendChild(label);
    });
    propertySection.appendChild(details);
  }

  const authorityStack = propertySection.querySelector(".option-stack");
  if (authorityStack) authorityStack.classList.add("hidden-booking-controls");
}

function rebuildExemptionSection() {
  const exemptionSection = document.querySelector('[aria-labelledby="exemption-heading"]');
  const propertySection = document.querySelector('[aria-labelledby="property-details-heading"]');
  if (!exemptionSection || exemptionSection.dataset.rebuilt === "true") return;
  exemptionSection.dataset.rebuilt = "true";

  if (propertySection && exemptionSection.previousElementSibling !== propertySection) {
    propertySection.insertAdjacentElement("afterend", exemptionSection);
  }

  const heading = document.querySelector("#exemption-heading");
  if (heading) heading.textContent = "Pool exemption";

  const toggleCard = exemptionSection.querySelector(".toggle-card");
  if (toggleCard) toggleCard.classList.add("hidden-booking-controls");

  const hasExemption = document.querySelector("#hasPoolExemption");
  const uploadPanel = document.querySelector("#exemption-upload-panel");
  const choiceGroup = document.createElement("div");
  choiceGroup.className = "clean-choice-group";
  choiceGroup.innerHTML = `
    <p class="section-helper">Tell us if the property has a pool exemption. Only upload a document if you choose Yes.</p>
    <div class="clean-choice-grid clean-choice-grid--three" role="radiogroup" aria-label="Pool exemption status"></div>
  `;

  const grid = choiceGroup.querySelector(".clean-choice-grid");
  [
    { value: "no", title: "No", helper: "No exemption that I know of.", checked: true },
    { value: "unsure", title: "Not sure", helper: "IronGate can review this before attending." },
    { value: "yes", title: "Yes", helper: "I will upload the exemption document." }
  ].forEach((option) => grid.appendChild(buildCleanChoiceCard({ name: "poolExemptionChoice", ...option })));

  exemptionSection.insertBefore(choiceGroup, uploadPanel || null);

  function syncExemption() {
    const value = exemptionSection.querySelector('input[name="poolExemptionChoice"]:checked')?.value || "no";
    if (hasExemption) {
      hasExemption.checked = value === "yes";
      hasExemption.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (uploadPanel) uploadPanel.classList.toggle("is-visible", value === "yes");
    updateSelectedChoiceCards(exemptionSection);
  }

  exemptionSection.addEventListener("change", syncExemption);
  syncExemption();
}

function rebuildAccessSection() {
  const accessSection = document.querySelector('[aria-labelledby="access-heading"]');
  if (!accessSection || accessSection.dataset.rebuilt === "true") return;
  accessSection.dataset.rebuilt = "true";

  const heading = document.querySelector("#access-heading");
  if (heading) heading.textContent = "Access details";

  const oldStack = accessSection.querySelector(".option-stack");
  if (oldStack) oldStack.classList.add("hidden-booking-controls");

  const willBeHome = document.querySelector("#willBeHomeForInspection");
  const accessPermission = document.querySelector("#accessPermissionIfNotHome");
  const animalsOnProperty = document.querySelector("#animalsOnProperty");
  const animalsOffLeash = document.querySelector("#animalsOffLeash");
  const animalsWillBeSecured = document.querySelector("#animalsWillBeSecured");
  const animalPanel = document.querySelector("#animal-restraint-panel");

  const cleanAccess = document.createElement("div");
  cleanAccess.className = "clean-choice-group";
  cleanAccess.innerHTML = `
    <div class="clean-choice-group">
      <p class="section-helper">How should we access the pool area?</p>
      <div class="clean-choice-grid" role="radiogroup" aria-label="Inspection access arrangement"></div>
    </div>
    <div class="clean-choice-group">
      <p class="section-helper">Are there dogs, animals or site hazards we should know about?</p>
      <div class="clean-choice-grid" role="radiogroup" aria-label="Animal or site hazard status"></div>
    </div>
  `;

  const accessGrid = cleanAccess.querySelectorAll(".clean-choice-grid")[0];
  accessGrid.appendChild(buildCleanChoiceCard({ name: "accessArrangement", value: "home", title: "Someone will be home", helper: "We can meet the owner, tenant or authorised person on site.", checked: true }));
  accessGrid.appendChild(buildCleanChoiceCard({ name: "accessArrangement", value: "safe_access", title: "Safe access available", helper: "Side gate, lockbox, key or arranged access is available." }));

  const hazardGrid = cleanAccess.querySelectorAll(".clean-choice-grid")[1];
  hazardGrid.appendChild(buildCleanChoiceCard({ name: "hazardStatus", value: "no", title: "No known animals or hazards", helper: "Nothing special to note before attending.", checked: true }));
  hazardGrid.appendChild(buildCleanChoiceCard({ name: "hazardStatus", value: "yes", title: "Yes, there are animals or hazards", helper: "Tell us in the access notes below." }));

  accessSection.insertBefore(cleanAccess, oldStack || accessSection.firstChild?.nextSibling || null);

  function syncAccess() {
    const accessValue = accessSection.querySelector('input[name="accessArrangement"]:checked')?.value || "home";
    const hazardValue = accessSection.querySelector('input[name="hazardStatus"]:checked')?.value || "no";

    if (willBeHome) willBeHome.checked = accessValue === "home";
    if (accessPermission) accessPermission.checked = accessValue === "safe_access";

    const hasHazard = hazardValue === "yes";
    if (animalsOnProperty) animalsOnProperty.checked = hasHazard;
    if (animalsOffLeash) animalsOffLeash.checked = false;
    if (!hasHazard && animalsWillBeSecured) animalsWillBeSecured.checked = false;
    if (animalPanel) animalPanel.classList.toggle("is-visible", hasHazard);

    [willBeHome, accessPermission, animalsOnProperty, animalsOffLeash].forEach((input) => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    updateSelectedChoiceCards(accessSection);
  }

  accessSection.addEventListener("change", syncAccess);
  syncAccess();
}

function rebuildFinalSection() {
  const finalSection = document.querySelector('[aria-labelledby="final-details-heading"]');
  if (!finalSection || finalSection.dataset.rebuilt === "true") return;
  finalSection.dataset.rebuilt = "true";

  const heading = document.querySelector("#final-details-heading");
  if (heading) heading.textContent = "Final confirmation";

  const finalStack = finalSection.querySelector(".option-stack");
  const minorRepairs = document.querySelector("#minorRepairsContactAccepted")?.closest("label");
  if (minorRepairs) minorRepairs.classList.add("hidden-booking-controls");

  const isOwner = document.querySelector("#isPropertyOwner");
  const authorised = document.querySelector("#authorisedToBook");
  const authorityCard = buildCleanChoiceCard({
    name: "bookingAuthorityConfirmed",
    value: "yes",
    type: "checkbox",
    id: "bookingAuthorityConfirmed",
    title: "I am the property owner or authorised to book this inspection.",
    helper: "This can include an owner, tenant, family member, agent or property manager with permission."
  });
  authorityCard.querySelector("input")?.setAttribute("required", "required");

  const existingFirstVisible = finalStack?.querySelector("label:not(.hidden-booking-controls)");
  if (finalStack) {
    finalStack.classList.add("final-confirmation-stack");
    finalStack.insertBefore(authorityCard, existingFirstVisible || finalStack.firstChild);
  }

  function syncAuthority() {
    const checked = document.querySelector("#bookingAuthorityConfirmed")?.checked === true;
    if (isOwner) isOwner.checked = false;
    if (authorised) authorised.checked = checked;
    updateSelectedChoiceCards(finalSection);
  }

  finalSection.addEventListener("change", syncAuthority);
  syncAuthority();
}

function softenPoolRegisterPanel() {
  document.querySelectorAll(".pool-register-panel").forEach((panel) => {
    const status = panel.dataset.status;
    const title = panel.querySelector(".pool-register-title");
    const text = panel.querySelector(".pool-register-text");
    const overrideLabel = panel.querySelector("label.option-card span");

    if (status === "not_found") {
      if (title) title.textContent = "No automatic register match found";
      if (text) text.textContent = "We could not automatically match this address on the Queensland pool register. You can still continue if there is a pool at this property.";
      if (overrideLabel) {
        overrideLabel.innerHTML = "Continue — there is a pool at this property.<small>IronGate will review this before attending.</small>";
      }
    }

    if (status === "manual_required") {
      if (title) title.textContent = "Pool register check needs review";
      if (text) text.textContent = "Automatic verification could not be completed. You can still continue if there is a pool at this property.";
      if (overrideLabel) {
        overrideLabel.innerHTML = "Continue — there is a pool at this property.<small>IronGate will review this before attending.</small>";
      }
    }
  });
}

function watchPoolRegisterPanel() {
  softenPoolRegisterPanel();
  if (!form || form.dataset.poolRegisterObserver === "true") return;
  form.dataset.poolRegisterObserver = "true";
  const observer = new MutationObserver(softenPoolRegisterPanel);
  observer.observe(form, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-status"] });
}

function rebuildBookingExperience() {
  injectBookingCalmStyles();
  removeInternalBookingNote();
  setHomeownerContactCopy();
  hidePublicAgentBookingUi();
  rebuildPropertySection();
  rebuildExemptionSection();
  rebuildAccessSection();
  rebuildFinalSection();
  watchPoolRegisterPanel();
  updateSelectedChoiceCards();
  collectBookingContext();
}

rebuildBookingExperience();

if (form) {
  form.addEventListener("input", collectBookingContext, true);
  form.addEventListener("submit", collectBookingContext, true);
}
