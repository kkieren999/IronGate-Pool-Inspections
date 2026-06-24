(() => {
  if (window.__irongatePoolRegisterStreetNumberGuard) return;
  window.__irongatePoolRegisterStreetNumberGuard = true;

  const originalFetch = window.fetch.bind(window);

  function normaliseStreetNumber(value) {
    const cleaned = String(value || "")
      .toUpperCase()
      .replace(/[^A-Z0-9\s/.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const slashMatch = cleaned.match(/\/(\d+[A-Z]?)/);
    if (slashMatch) return slashMatch[1];
    const match = cleaned.match(/\d+[A-Z]?(?:-\d+[A-Z]?)?/);
    return match ? match[0] : "";
  }

  function recordValue(record, key) {
    return record?.[key] ?? record?.[key.replace(/ /g, " ")] ?? "";
  }

  function selectedStreetNumber() {
    return normaliseStreetNumber(document.querySelector("#propertyAddress")?.value || "");
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const rawUrl = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

    if (!rawUrl.includes("data.qld.gov.au/api/3/action/datastore_search")) return response;

    const selectedNumber = selectedStreetNumber();
    if (!selectedNumber) return response;

    try {
      const data = await response.clone().json();
      const records = Array.isArray(data?.result?.records) ? data.result.records : [];
      data.result.records = records.filter((record) => {
        return normaliseStreetNumber(recordValue(record, "Street Number")) === selectedNumber;
      });
      data.result.total = data.result.records.length;

      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(data), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.warn("Pool register street-number guard could not inspect response", error);
      return response;
    }
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".main-nav");
  const navLinks = document.querySelectorAll(".main-nav a");
  const year = document.querySelector("#year");

  if (year) year.textContent = new Date().getFullYear();

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
      navToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
    });
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      if (nav) nav.classList.remove("open");
      if (navToggle) {
        navToggle.setAttribute("aria-expanded", "false");
        navToggle.setAttribute("aria-label", "Open navigation");
      }
      navLinks.forEach((item) => item.classList.remove("active"));
      link.classList.add("active");
    });
  });

  const sections = [...document.querySelectorAll("main section[id]")];
  if ("IntersectionObserver" in window && sections.length && navLinks.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => {
          link.classList.toggle("active", link.getAttribute("href") === `#${entry.target.id}`);
        });
      });
    }, { rootMargin: "-35% 0px -55% 0px", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
  }

  const closeModal = (modal) => {
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  };

  const openModal = (modal) => {
    if (!modal) return;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    const closeButton = modal.querySelector("[data-modal-close]");
    if (closeButton) closeButton.focus();
  };

  document.addEventListener("click", (event) => {
    const openTrigger = event.target.closest("[data-modal-open]");
    if (openTrigger) {
      event.preventDefault();
      openModal(document.getElementById(openTrigger.dataset.modalOpen));
      return;
    }

    const closeTrigger = event.target.closest("[data-modal-close]");
    if (closeTrigger) {
      event.preventDefault();
      closeModal(closeTrigger.closest(".modal-overlay"));
      return;
    }

    if (event.target.classList && event.target.classList.contains("modal-overlay")) {
      closeModal(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".modal-overlay.is-open").forEach(closeModal);
  });

  const style = document.createElement("style");
  style.textContent = `
    .address-suggestions[hidden], .address-suggestions:empty {
      display: none !important;
      padding: 0 !important;
      border: 0 !important;
      box-shadow: none !important;
      margin: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    .address-status {
      display: none !important;
      margin: 0 !important;
      height: 0 !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }
    .pool-register-panel.is-compact {
      display: block !important;
      margin-top: 6px !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    .pool-register-compact-line {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin: 6px 0 0;
      font-size: .88rem;
      font-weight: 800;
      line-height: 1.35;
    }
    .pool-register-compact-line.is-green { color: #0f8a43; }
    .pool-register-compact-line.is-red { color: #d61f1f; }
    .pool-register-compact-line.is-orange { color: #9a3412; }
    .pool-register-compact-btn {
      border: 0;
      border-radius: 999px;
      padding: 6px 11px;
      background: var(--navy);
      color: #fff;
      font-size: .8rem;
      font-weight: 900;
      cursor: pointer;
    }
    .pool-register-hidden-control {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      overflow: hidden !important;
      clip: rect(0 0 0 0) !important;
      white-space: nowrap !important;
    }
    .auto-filled-field select,
    select.auto-filled-field {
      border-color: rgba(15,138,67,.65) !important;
      box-shadow: 0 0 0 3px rgba(15,138,67,.11) !important;
      background: #f4fff8 !important;
    }
  `;
  document.head.appendChild(style);

  function cleanOutcomeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^A registered pool was found for this address\.\s*/i, "")
      .replace(/^Registered pool details matched the selected address\.\s*/i, "")
      .trim();
  }

  function markAutoFilled(field) {
    if (!field) return;
    const label = field.closest("label");
    field.classList.add("auto-filled-field");
    if (label) label.classList.add("auto-filled-field");
  }

  function setSelectValue(id, value, overwrite = true) {
    const field = document.querySelector(`#${id}`);
    if (!field) return;
    if (!overwrite && field.value) return;
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    markAutoFilled(field);
  }

  function rebuildPoolTypeDropdown() {
    const poolType = document.querySelector("#poolType");
    if (!poolType || poolType.dataset.rebuilt === "true") return;
    const currentValue = poolType.value && poolType.value !== "Shared pool" ? poolType.value : "";
    poolType.innerHTML = `
      <option value="">Select one</option>
      <option value="Swimming pool">Swimming pool</option>
      <option value="Spa">Spa</option>
      <option value="Portable or above-ground pool">Portable or above-ground pool</option>
      <option value="Other">Other</option>
      <option value="Unsure">Unsure</option>
    `;
    poolType.value = currentValue;
    poolType.dataset.rebuilt = "true";
  }

  function ensurePoolAccessTypeDropdown() {
    if (document.querySelector("#poolAccessType")) return;
    const registeredLabel = document.querySelector("#poolRegisteredStatus")?.closest("label");
    if (!registeredLabel) return;

    const label = document.createElement("label");
    label.innerHTML = `
      Pool access type
      <select id="poolAccessType" required>
        <option value="">Select one</option>
        <option value="Non-shared pool">Non-shared pool</option>
        <option value="Shared pool">Shared pool</option>
        <option value="Unsure">Unsure</option>
      </select>
    `;
    registeredLabel.insertAdjacentElement("afterend", label);
  }

  function populateFields(status, detailText) {
    if (status === "registered") {
      const isShared = /Shared pool:\s*Yes/i.test(detailText);
      setSelectValue("poolRegisteredStatus", "Yes");
      setSelectValue("poolAccessType", isShared ? "Shared pool" : "Non-shared pool");
      return;
    }

    if (status === "not_found") {
      setSelectValue("poolRegisteredStatus", "No", false);
      setSelectValue("poolAccessType", "Unsure", false);
    }
  }

  function compactPoolRegisterPanel() {
    const panel = document.querySelector(".pool-register-panel");
    if (!panel || panel.hidden) return;

    const status = panel.dataset.status || "";
    if (!status) return;

    const alreadyCompact = panel.querySelector(".pool-register-compact-line");
    if (alreadyCompact && panel.dataset.compactStatus === status) return;

    const detailText = cleanOutcomeText(panel.querySelector(".pool-register-details")?.textContent || "");
    const input = panel.querySelector("#poolRegisterLooksRight, #poolRegisterOverride");
    const hiddenControl = document.createElement("span");
    hiddenControl.className = "pool-register-hidden-control";
    if (input) hiddenControl.appendChild(input);

    populateFields(status, detailText);
    panel.classList.add("is-compact");
    panel.dataset.compactStatus = status;

    if (status === "checking") {
      panel.innerHTML = '<p class="pool-register-compact-line is-orange">Checking pool registration...</p>';
      return;
    }

    if (status === "registered") {
      if (input && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      panel.innerHTML = '<p class="pool-register-compact-line is-green"><span>✓ Registered pool found</span></p>';
      if (input) panel.appendChild(hiddenControl);
      return;
    }

    if (status === "not_found" || status === "manual_required") {
      const lineClass = status === "not_found" ? "is-red" : "is-orange";
      const label = status === "not_found" ? "✕ No registered pool found for this address" : "Pool register check unavailable";
      panel.innerHTML = `<p class="pool-register-compact-line ${lineClass}"><span>${label}</span><button class="pool-register-compact-btn" type="button" id="pool-register-compact-override">Continue anyway</button></p>`;
      if (input) panel.appendChild(hiddenControl);
      const button = panel.querySelector("#pool-register-compact-override");
      if (button && input) {
        button.addEventListener("click", () => {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          button.textContent = "Continue enabled";
          button.disabled = true;
        });
      }
    }
  }

  function appendPoolAccessTypeToNotes() {
    const form = document.querySelector("#booking-form");
    const notes = document.querySelector("#notes");
    const accessType = document.querySelector("#poolAccessType");
    if (!form || !notes || !accessType || form.dataset.poolAccessNotesHook === "true") return;

    form.dataset.poolAccessNotesHook = "true";
    form.addEventListener("submit", () => {
      const accessValue = accessType.value || "Not supplied";
      const marker = "Pool access type:";
      const existingNotes = notes.value.replace(/^Pool access type:.*\n?/m, "").trim();
      notes.value = `${marker} ${accessValue}${existingNotes ? `\n${existingNotes}` : ""}`;
    }, true);
  }

  const statusText = document.querySelector("#address-status");
  if (statusText) statusText.textContent = "";

  rebuildPoolTypeDropdown();
  ensurePoolAccessTypeDropdown();
  appendPoolAccessTypeToNotes();

  const pageObserver = new MutationObserver(() => {
    rebuildPoolTypeDropdown();
    ensurePoolAccessTypeDropdown();
    appendPoolAccessTypeToNotes();
    compactPoolRegisterPanel();
  });

  pageObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-status", "hidden"]
  });

  compactPoolRegisterPanel();
});
