const tabs = document.querySelectorAll(".tab");
const pages = document.querySelectorAll(".page");
const newInspectionBtn = document.querySelector("#newInspectionBtn");

const inspectionsKey = "irongateInspections";
let currentInspectionId = null;
let currentTab = "home";
let inspectionStarted = false;
let fenceCounter = 0;
let climbabilityCounter = 0;

function getTabName(tab) {
  return tab.dataset.tab || tab.getAttribute("href")?.replace("#", "") || "";
}

function getAllInspections() {
  try {
    return JSON.parse(localStorage.getItem(inspectionsKey)) || [];
  } catch {
    return [];
  }
}

function saveAllInspections(inspections) {
  localStorage.setItem(inspectionsKey, JSON.stringify(inspections));
}

function makeId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return `inspection-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateInspectionNumber() {
  const year = new Date().getFullYear();
  const inspections = getAllInspections();
  const usedNumbers = inspections
    .map((item) => item.inspectionNumber || item.fields?.find((f) => f.name === "inspectionNumber")?.value || "")
    .filter((num) => num.startsWith(`IG-${year}-`))
    .map((num) => Number(num.split("-").pop()))
    .filter(Number.isFinite);

  const nextNumber = usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1;
  return `IG-${year}-${String(nextNumber).padStart(4, "0")}`;
}

function setNavLock(tabName) {
  const isLocked = tabName === "home" && !inspectionStarted;

  tabs.forEach((tab) => {
    const name = getTabName(tab);
    const locked = isLocked && name !== "home";
    tab.classList.toggle("locked", locked);
    tab.setAttribute("aria-disabled", locked ? "true" : "false");
  });
}

function showTab(tabName) {
  currentTab = tabName;

  pages.forEach((page) => {
    page.classList.toggle("active-page", page.id === tabName);
  });

  tabs.forEach((tab) => {
    tab.classList.toggle("active", getTabName(tab) === tabName);
  });

  setNavLock(tabName);
  history.replaceState(null, "", `#${tabName}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    const requestedTab = getTabName(tab);

    if (!inspectionStarted && currentTab === "home" && requestedTab !== "home") return;

    showTab(requestedTab);
  });
});

function resetScreenForNewInspection() {
  document.querySelectorAll("[data-save]").forEach((el) => {
    if (el.type === "checkbox") el.checked = false;
    else if (el.tagName === "SELECT") el.selectedIndex = 0;
    else el.value = "";
  });

  document.querySelectorAll(".photo-grid").forEach((grid) => (grid.innerHTML = ""));
  document.querySelectorAll(".fence-card").forEach((card) => card.remove());
  fenceCounter = 0;
  climbabilityCounter = 0;
}

function startNewInspection() {
  resetScreenForNewInspection();

  currentInspectionId = makeId();
  inspectionStarted = true;
  document.body.dataset.createdAt = new Date().toISOString();

  const inspectionNumberField = document.querySelector('[name="inspectionNumber"]');
  if (inspectionNumberField) inspectionNumberField.value = generateInspectionNumber();

  const dateInput = document.querySelector("#inspectionDate");
  if (dateInput) dateInput.value = todayInputValue();

  addFenceSection();
  addClimbabilitySection();

  showTab("details");
  saveInspection(false);
}

newInspectionBtn?.addEventListener("click", startNewInspection);
newInspectionBtn?.addEventListener("touchend", (event) => {
  event.preventDefault();
  startNewInspection();
}, { passive: false });

function mountPhotoWidget(target) {
  if (!target) return;
  if (target.querySelector(".photo-widget")) return;

  const tpl = document.getElementById("photoTemplate")?.content.cloneNode(true);
  if (!tpl) return;

  const input = tpl.querySelector('input[type="file"]');
  const btn = tpl.querySelector(".camera-btn");
  const grid = tpl.querySelector(".photo-grid");

  btn?.addEventListener("click", () => input?.click());

  input?.addEventListener("change", (event) => {
    [...event.target.files].forEach((file) => {
      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        addPhoto(grid, readerEvent.target.result);
        saveInspection(false);
      };
      reader.readAsDataURL(file);
    });
    input.value = "";
  });

  target.appendChild(tpl);
}

function addPhoto(grid, src) {
  if (!grid) return;

  const box = document.createElement("div");
  box.className = "photo-box";
  const stamp = new Date().toLocaleString();

  box.innerHTML = `
    <img src="${src}" alt="inspection photo">
    <button class="remove-photo" type="button" aria-label="Remove photo">×</button>
    <div class="timestamp">${stamp}<br>IronGate Pool Inspections</div>
  `;

  box.querySelector(".remove-photo")?.addEventListener("click", () => {
    box.remove();
    saveInspection(false);
  });

  grid.appendChild(box);
}

document.querySelectorAll(".photo-area").forEach(mountPhotoWidget);

function fenceTemplate(number) {
  return `
    <div class="fence-card-head">
      <h3>Fence Section ${number}</h3>
      <button class="remove-section-btn" type="button">Remove</button>
    </div>

    <label class="check-field defect-toggle">
      <input data-save name="fenceNonCompliant" type="checkbox" />
      <span>Non-compliant</span>
    </label>

    <div class="form-grid">
      <label class="field full">
        <span>Location</span>
        <input data-save name="fenceLocation" type="text" placeholder="e.g. North side fence" />
      </label>

      <label class="field">
        <span>Fence Type</span>
        <select data-save name="fenceType">
          <option value="">Select type</option>
          <option>Aluminium</option>
          <option>Glass</option>
          <option>Timber</option>
          <option>Chainwire / mesh</option>
          <option>Masonry</option>
          <option>Other</option>
        </select>
      </label>

      <label class="field">
        <span>Height (mm)</span>
        <input data-save name="fenceHeight" type="number" placeholder="1200" />
      </label>

      <label class="field">
        <span>Ground Clearance (mm)</span>
        <input data-save name="fenceGroundClearance" type="number" placeholder="100" />
      </label>

      <label class="field">
        <span>Openings / Gaps Compliant</span>
        <select data-save name="fenceGaps">
          <option>Pass</option><option>Fail</option><option>N/A</option>
        </select>
      </label>

      <label class="field full">
        <span>Comments / Recommendation</span>
        <textarea data-save name="fenceComments" placeholder="Notes, non-compliance details or recommendation..."></textarea>
      </label>
    </div>

    <div class="photo-area fence-photo-area" data-photo-area="fence-${number}"></div>
  `;
}

function addFenceSection(data = null) {
  const list = document.querySelector("#fenceSections");
  if (!list) return;

  fenceCounter += 1;
  const card = document.createElement("article");
  card.className = "fence-card";
  card.dataset.section = "fence";
  card.innerHTML = fenceTemplate(fenceCounter);

  card.querySelector(".remove-section-btn")?.addEventListener("click", () => {
    card.remove();
    renumberFenceSections();
    refreshSummary();
    saveInspection(false);
  });

  card.querySelectorAll("[data-save]").forEach((el) => {
    el.addEventListener("change", () => {
      inspectionStarted = true;
      refreshSummary();
      saveInspection(false);
    });
  });

  mountPhotoWidget(card.querySelector(".photo-area"));
  list.appendChild(card);
  if (data) restoreFenceSection(card, data);
  refreshSummary();
}

function renumberFenceSections() {
  document.querySelectorAll(".fence-card:not(.climbability-card)").forEach((card, index) => {
    card.querySelector("h3").textContent = `Fence Section ${index + 1}`;
  });
}

document.querySelector("#addFenceSectionBtn")?.addEventListener("click", () => {
  inspectionStarted = true;
  addFenceSection();
  saveInspection(false);
});

function climbabilityTemplate(number) {
  return `
    <div class="fence-card-head">
      <h3>Climbability Check ${number}</h3>
      <button class="remove-section-btn" type="button">Remove</button>
    </div>

    <label class="check-field defect-toggle">
      <input data-save name="climbabilityNonCompliant" type="checkbox" />
      <span>Non-compliant</span>
    </label>

    <div class="form-grid">
      <label class="field full">
        <span>Location</span>
        <input data-save name="nczLocation" type="text" placeholder="e.g. Near pump equipment" />
      </label>

      <label class="field">
        <span>Object Type</span>
        <select data-save name="nczObjectType">
          <option>None observed</option>
          <option>Tree / vegetation</option>
          <option>Pot plant</option>
          <option>Furniture</option>
          <option>Pool equipment</option>
          <option>Retaining wall</option>
          <option>Tap / power outlet</option>
          <option>Other</option>
        </select>
      </label>

      <label class="field">
        <span>Distance From Barrier (mm)</span>
        <input data-save name="nczDistance" type="number" placeholder="900" />
      </label>

      <label class="field">
        <span>NCZ Compliant</span>
        <select data-save name="nczCompliant">
          <option>Pass</option><option>Fail</option><option>N/A</option>
        </select>
      </label>

      <label class="field full">
        <span>Comments / Recommendation</span>
        <textarea data-save name="nczComments" placeholder="Notes, non-compliance details or recommendation..."></textarea>
      </label>
    </div>

    <div class="photo-area climbability-photo-area" data-photo-area="climbability-${number}"></div>
  `;
}

function addClimbabilitySection(data = null) {
  const list = document.querySelector("#climbabilitySections");
  if (!list) return;

  climbabilityCounter += 1;
  const card = document.createElement("article");
  card.className = "fence-card climbability-card";
  card.dataset.section = "climbabilityItem";
  card.innerHTML = climbabilityTemplate(climbabilityCounter);

  card.querySelector(".remove-section-btn")?.addEventListener("click", () => {
    card.remove();
    renumberClimbabilitySections();
    refreshSummary();
    saveInspection(false);
  });

  card.querySelectorAll("[data-save]").forEach((el) => {
    el.addEventListener("change", () => {
      inspectionStarted = true;
      refreshSummary();
      saveInspection(false);
    });
  });

  mountPhotoWidget(card.querySelector(".photo-area"));
  list.appendChild(card);
  if (data) restoreClimbabilitySection(card, data);
  refreshSummary();
}

function renumberClimbabilitySections() {
  document.querySelectorAll(".climbability-card").forEach((card, index) => {
    card.querySelector("h3").textContent = `Climbability Check ${index + 1}`;
  });
}

document.querySelector("#addClimbabilitySectionBtn")?.addEventListener("click", () => {
  inspectionStarted = true;
  addClimbabilitySection();
  saveInspection(false);
});

function getFieldLabel(el) {
  return el.closest("label")?.querySelector("span")?.textContent.trim() || el.name;
}

function markFailures() {
  document.querySelectorAll(".section-card[data-section], .fence-card").forEach((card) => {
    const nonCompliantChecked = card.querySelector(".defect-toggle input")?.checked || false;
    const failedSelect = [...card.querySelectorAll("select")].some((select) => select.value === "Fail");
    card.classList.toggle("defect-active", nonCompliantChecked);
    card.classList.toggle("fail-highlight", failedSelect);
  });
}

function refreshSummary() {
  markFailures();
  const summary = document.getElementById("failureSummary");
  if (!summary) return;
  summary.innerHTML = "";

  document.querySelectorAll(".fence-card:not(.climbability-card)").forEach((card) => {
    addCardToSummary(card, "Fence Section", 'input[name="fenceLocation"]');
  });

  document.querySelectorAll(".climbability-card").forEach((card) => {
    addCardToSummary(card, "Climbability Check", 'input[name="nczLocation"]');
  });

  document.querySelectorAll(".section-card[data-section]").forEach((card) => {
    const section = card.dataset.section;
    if (["details", "barrier", "climbability"].includes(section)) return;
    addCardToSummary(card, card.querySelector("h2")?.textContent || section, 'input[name$="Location"]');
  });

  if (!summary.children.length) {
    const li = document.createElement("li");
    li.textContent = "No non-compliant checklist items recorded yet.";
    summary.appendChild(li);
  }
}

function addCardToSummary(card, fallbackTitle, locationSelector) {
  const summary = document.getElementById("failureSummary");
  if (!summary) return;

  const title = card.querySelector("h3")?.textContent || card.querySelector("h2")?.textContent || fallbackTitle;
  const location = card.querySelector(locationSelector)?.value || card.querySelector('input[name="safetyLocation"]')?.value || "location not entered";
  const nonCompliantChecked = card.querySelector(".defect-toggle input")?.checked || false;
  const failed = [...card.querySelectorAll("select")].filter((select) => select.value === "Fail");
  const comments = [...card.querySelectorAll("textarea")].map((textarea) => textarea.value.trim()).filter(Boolean).join(" ");

  if (nonCompliantChecked || failed.length) {
    const li = document.createElement("li");
    const failText = failed.length ? failed.map(getFieldLabel).join(", ") : "Non-compliant";
    li.textContent = `${title} - ${location}: ${failText}.${comments ? " " + comments : ""}`;
    summary.appendChild(li);
  }
}

function gatherFenceSections() {
  return [...document.querySelectorAll(".fence-card:not(.climbability-card)")].map((card) => ({
    values: [...card.querySelectorAll("[data-save]")].map((el) => ({ name: el.name, value: el.type === "checkbox" ? el.checked : el.value })),
    photos: [...card.querySelectorAll(".photo-box img")].map((img) => img.src),
  }));
}

function gatherClimbabilitySections() {
  return [...document.querySelectorAll(".climbability-card")].map((card) => ({
    values: [...card.querySelectorAll("[data-save]")].map((el) => ({ name: el.name, value: el.type === "checkbox" ? el.checked : el.value })),
    photos: [...card.querySelectorAll(".photo-box img")].map((img) => img.src),
  }));
}

function fieldValue(fields, name) {
  return fields.find((f) => f.name === name)?.value || "";
}

function gatherData() {
  const fields = [...document.querySelectorAll("[data-save]")]
    .filter((el) => !el.closest(".fence-card") && !el.closest(".climbability-card"))
    .map((el) => ({ name: el.name, value: el.type === "checkbox" ? el.checked : el.value }));

  const photos = [...document.querySelectorAll(".section-card > .photo-area")].map((area) => ({
    area: area.dataset.photoArea,
    images: [...area.querySelectorAll(".photo-box img")].map((img) => img.src),
  }));

  const now = new Date().toISOString();
  const inspectionNumber = fieldValue(fields, "inspectionNumber") || generateInspectionNumber();

  return {
    id: currentInspectionId || makeId(),
    inspectionNumber,
    inspectionStarted,
    createdAt: document.body.dataset.createdAt || now,
    updatedAt: now,
    fields,
    photos,
    fenceSections: gatherFenceSections(),
    climbabilitySections: gatherClimbabilitySections(),
  };
}

function saveInspection(showAlert = true) {
  if (!inspectionStarted && !currentInspectionId) return;

  const data = gatherData();
  currentInspectionId = data.id;
  document.body.dataset.createdAt = data.createdAt;

  const inspections = getAllInspections();
  const existingIndex = inspections.findIndex((item) => item.id === data.id);

  if (existingIndex >= 0) inspections[existingIndex] = data;
  else inspections.push(data);

  const savedOk = saveAllInspections(inspections);
  renderInspectionList();

  if (showAlert && savedOk) alert("Inspection saved on this device.");
}

function restoreFenceSection(card, data) {
  data.values?.forEach((saved) => {
    const el = card.querySelector(`[name="${saved.name}"]`);
    if (!el) return;
    if (el.type === "checkbox") el.checked = saved.value;
    else el.value = saved.value;
  });

  const grid = card.querySelector(".photo-grid");
  data.photos?.forEach((src) => addPhoto(grid, src));
}

function restoreClimbabilitySection(card, data) {
  data.values?.forEach((saved) => {
    const el = card.querySelector(`[name="${saved.name}"]`);
    if (!el) return;
    if (el.type === "checkbox") el.checked = saved.value;
    else el.value = saved.value;
  });

  const grid = card.querySelector(".photo-grid");
  data.photos?.forEach((src) => addPhoto(grid, src));
}

function restoreInspectionData(data, showAlert = false) {
  if (!data) return;

  resetScreenForNewInspection();
  currentInspectionId = data.id;
  inspectionStarted = true;
  document.body.dataset.createdAt = data.createdAt || new Date().toISOString();

  data.fields?.forEach((saved) => {
    const el = document.querySelector(`[name="${saved.name}"]`);
    if (!el || el.closest(".fence-card") || el.closest(".climbability-card")) return;
    if (el.type === "checkbox") el.checked = saved.value;
    else el.value = saved.value;
  });

  if (!document.querySelector('[name="inspectionNumber"]')?.value) {
    document.querySelector('[name="inspectionNumber"]').value = data.inspectionNumber || generateInspectionNumber();
  }

  data.photos?.forEach((photoSet) => {
    const area = document.querySelector(`.section-card > [data-photo-area="${photoSet.area}"]`);
    const grid = area?.querySelector(".photo-grid");
    if (!grid) return;
    photoSet.images?.forEach((src) => addPhoto(grid, src));
  });

  if (data.fenceSections?.length) data.fenceSections.forEach((fenceData) => addFenceSection(fenceData));
  else addFenceSection();

  if (data.climbabilitySections?.length) data.climbabilitySections.forEach((climbabilityData) => addClimbabilitySection(climbabilityData));
  else addClimbabilitySection();

  refreshSummary();
  setNavLock(currentTab);
  if (showAlert) alert("Inspection loaded.");
}

function loadInspection(showAlert = true) {
  if (!currentInspectionId) {
    if (showAlert) alert("Select an inspection from the Home page first.");
    return;
  }

  const inspection = getAllInspections().find((item) => item.id === currentInspectionId);
  if (!inspection) {
    if (showAlert) alert("No saved inspection found.");
    return;
  }

  restoreInspectionData(inspection, showAlert);
}

function clearInspection() {
  if (!confirm("Clear the current form from the screen? This will not delete saved inspections from the Home list.")) return;
  resetScreenForNewInspection();
  currentInspectionId = null;
  inspectionStarted = false;
  document.body.dataset.createdAt = "";
  refreshSummary();
  renderInspectionList();
  showTab("home");
}

function deleteInspection(id) {
  if (!confirm("Delete this saved inspection from this device?")) return;
  const inspections = getAllInspections().filter((item) => item.id !== id);
  saveAllInspections(inspections);

  if (currentInspectionId === id) {
    resetScreenForNewInspection();
    currentInspectionId = null;
    inspectionStarted = false;
    showTab("home");
  }

  renderInspectionList();
}

function formatDate(dateString) {
  if (!dateString) return "No date";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function renderInspectionList() {
  const list = document.querySelector("#inspectionList");
  const empty = document.querySelector("#emptyState");
  if (!list) return;

  const inspections = getAllInspections().sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  list.innerHTML = "";

  empty?.classList.toggle("hidden", inspections.length > 0);
  if (empty) empty.style.display = inspections.length ? "none" : "block";

  inspections.forEach((inspection) => {
    const fields = inspection.fields || [];
    const number = inspection.inspectionNumber || fieldValue(fields, "inspectionNumber") || "No inspection number";
    const owner = fieldValue(fields, "ownerName") || "Unnamed client";
    const address = fieldValue(fields, "propertyAddress") || "No address entered";
    const date = fieldValue(fields, "inspectionDate") || inspection.createdAt;

    const card = document.createElement("article");
    card.className = "saved-inspection-card";
    card.innerHTML = `
      <div class="saved-inspection-main">
        <strong>${number}</strong>
        <span>${owner}</span>
        <span>${address}</span>
        <div class="saved-inspection-meta">
          <em>${formatDate(date)}</em>
          <em>Updated ${formatDate(inspection.updatedAt)}</em>
        </div>
      </div>
      <div class="saved-inspection-actions">
        <button class="open-inspection-btn" type="button">Open</button>
        <button class="delete-inspection-btn" type="button">Delete</button>
      </div>
    `;

    card.querySelector(".open-inspection-btn")?.addEventListener("click", () => {
      restoreInspectionData(inspection);
      showTab("details");
    });

    card.querySelector(".delete-inspection-btn")?.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteInspection(inspection.id);
    });

    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      restoreInspectionData(inspection);
      showTab("details");
    });

    list.appendChild(card);
  });
}

document.querySelector("#saveBtn")?.addEventListener("click", () => saveInspection(true));
document.querySelector("#loadBtn")?.addEventListener("click", () => loadInspection(true));
document.querySelector("#clearBtn")?.addEventListener("click", clearInspection);

document.querySelectorAll("[data-save]").forEach((el) => {
  if (el.closest(".fence-card") || el.closest(".climbability-card")) return;

  el.addEventListener("change", () => {
    if (currentTab !== "home") inspectionStarted = true;
    refreshSummary();
    saveInspection(false);
  });
});

renderInspectionList();
showTab("home");
refreshSummary();
