const form = document.querySelector("#booking-form");
const message = document.querySelector("#booking-message");
const submitButton = document.querySelector("#booking-submit");
const priceNotice = document.querySelector("#booking-price-notice");
const calendarGrid = document.querySelector("#calendar-grid");
const calendarTitle = document.querySelector("#calendar-title");
const calendarPrev = document.querySelector("#calendar-prev");
const calendarNext = document.querySelector("#calendar-next");
const preferredDateInput = document.querySelector("#preferredDate");
const preferredTimeSlotInput = document.querySelector("#preferredTimeSlot");
const selectedDateLabel = document.querySelector("#selected-date-label");
const selectedSlotLabel = document.querySelector("#selected-slot-label");
const bookingSlotGrid = document.querySelector("#booking-slot-grid");
const addressInput = document.querySelector("#propertyAddress");
const addressSelectedInput = document.querySelector("#propertyAddressSelected");
const propertyPlaceIdInput = document.querySelector("#propertyPlaceId");
const addressStatus = document.querySelector("#address-status");
const addressSuggestions = document.querySelector("#address-suggestions");
const exemptionToggle = document.querySelector("#hasPoolExemption");
const exemptionPanel = document.querySelector("#exemption-upload-panel");
const exemptionFileInput = document.querySelector("#exemptionFile");
const animalsOnPropertyInput = document.querySelector("#animalsOnProperty");
const animalsOffLeashInput = document.querySelector("#animalsOffLeash");
const animalPanel = document.querySelector("#animal-restraint-panel");

const inspectionPriceCents = 24900;
const inspectionPriceDisplay = "$249";
const maxUploadBytes = 10 * 1024 * 1024;
const GEOAPIFY_API_KEY = "8d1bacfb41584094b808c255bc8ef70c";
const QBCC_POOL_REGISTER_URL = "https://my.qbcc.qld.gov.au/myQBCC/s/pool-register";
const QLD_POOL_REGISTER_RESOURCE_ID = "bb059c35-d826-4ccd-af31-24de4716864a";
const QLD_DATASTORE_SEARCH_URL = "https://www.data.qld.gov.au/api/3/action/datastore_search";

// Leave blank while Firebase Functions billing is blocked.
// The page will try the Queensland Open Data lookup directly from the browser first.
const POOL_REGISTER_LOOKUP_ENDPOINT = "";

const STREET_TYPE_MAP = {
  "ALLEY": "ALLEY", "ALLY": "ALLEY",
  "AV": "AVENUE", "AVE": "AVENUE", "AVENUE": "AVENUE",
  "BVD": "BOULEVARD", "BLVD": "BOULEVARD", "BOULEVARD": "BOULEVARD",
  "CCT": "CIRCUIT", "CIRCUIT": "CIRCUIT",
  "CL": "CLOSE", "CLOSE": "CLOSE",
  "CT": "COURT", "COURT": "COURT",
  "CRES": "CRESCENT", "CR": "CRESCENT", "CRESCENT": "CRESCENT",
  "DR": "DRIVE", "DRIVE": "DRIVE",
  "ESPL": "ESPLANADE", "ESPLANADE": "ESPLANADE",
  "HWY": "HIGHWAY", "HIGHWAY": "HIGHWAY",
  "LANE": "LANE", "LN": "LANE",
  "PDE": "PARADE", "PARADE": "PARADE",
  "PL": "PLACE", "PLACE": "PLACE",
  "RD": "ROAD", "ROAD": "ROAD",
  "ST": "STREET", "STREET": "STREET",
  "TCE": "TERRACE", "TERRACE": "TERRACE",
  "WAY": "WAY"
};

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let selectedDate = "";
let selectedTimeSlot = null;
let selectedAddress = null;
let availabilityByDate = new Map();
let calendarMonth = startOfMonth(new Date());
let firebaseModulesPromise = null;
let addressSearchTimer = null;
let poolRegisterStatus = "not_checked";
let poolRegisterMessage = "";
let poolRegisterDetails = null;
let poolRegisterCheckedAt = null;
let poolRegisterLooksRight = false;
let poolRegisterOverrideConfirmed = false;
let poolRegisterPanel = null;

if (priceNotice) {
  priceNotice.textContent = `Pool Safety Inspection & Certificate — ${inspectionPriceDisplay}`;
}

function getValue(selector) {
  const element = document.querySelector(selector);
  return element ? element.value.trim() : "";
}

function getChecked(selector) {
  return document.querySelector(selector)?.checked === true;
}

function setLoading(isLoading, text = "Saving...") {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? text : "Save Booking Test";
}

function showMessage(text, type = "") {
  if (!message) return;
  message.textContent = text;
  message.dataset.type = type;
}

function setAddressStatus(text, type = "") {
  if (!addressStatus) return;
  addressStatus.textContent = text;
  addressStatus.dataset.type = type;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(dateKey) {
  const date = parseDateKey(dateKey);
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function isPastDate(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);
  return compare < today;
}

function minutesFromTime(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
  return hours * 60 + minutes;
}

function formatTimeLabel(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function timeFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function normaliseSlot(slot) {
  if (!slot?.start) return null;
  const startMinutes = minutesFromTime(slot.start);
  const start = timeFromMinutes(startMinutes);
  const end = slot.end || timeFromMinutes(startMinutes + 60);
  const id = slot.id || start.replace(":", "_");
  return {
    id,
    start,
    end,
    label: slot.label || `${formatTimeLabel(start)} – ${formatTimeLabel(end)}`,
    available: slot.available !== false,
    booked: slot.booked === true
  };
}

function normaliseSlots(saved, date) {
  if (isPastDate(date) || !saved?.slots) return [];
  const rawSlots = Array.isArray(saved.slots) ? saved.slots : Object.values(saved.slots || {});
  return rawSlots
    .map(normaliseSlot)
    .filter((slot) => slot && slot.available && !slot.booked)
    .sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start));
}

function getAvailableSlots(dateKey) {
  if (!dateKey) return [];
  const date = parseDateKey(dateKey);
  const saved = availabilityByDate.get(dateKey) || null;
  return normaliseSlots(saved, date);
}

function normaliseAvailability(dateKey, date) {
  const saved = availabilityByDate.get(dateKey) || null;
  const availableSlots = getAvailableSlots(dateKey);

  if (isPastDate(date)) return { status: "unavailable", label: "Past date", isBookable: false };
  if (availableSlots.length > 0) {
    return {
      status: "available",
      label: `${availableSlots.length} time${availableSlots.length === 1 ? "" : "s"}`,
      isBookable: true
    };
  }
  if (saved?.reason) return { status: "unavailable", label: saved.reason, isBookable: false };
  return { status: "unavailable", label: "No times", isBookable: false };
}

function renderCalendar() {
  if (!calendarGrid || !calendarTitle || !calendarPrev || !calendarNext) return;

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const todayMonth = startOfMonth(new Date());
  const monthEnd = getMonthEnd(calendarMonth);
  const daysInMonth = monthEnd.getDate();
  const firstWeekday = calendarMonth.getDay();

  calendarTitle.textContent = `${monthNames[month]} ${year}`;
  calendarPrev.disabled = calendarMonth <= todayMonth;
  calendarGrid.innerHTML = "";

  for (let index = 0; index < firstWeekday; index += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "calendar-empty";
    calendarGrid.appendChild(emptyCell);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const availability = normaliseAvailability(dateKey, date);
    const button = document.createElement("button");

    button.type = "button";
    button.className = `calendar-day calendar-day--${availability.status}`;
    button.dataset.date = dateKey;
    button.disabled = !availability.isBookable;
    button.setAttribute("aria-label", `${formatDisplayDate(dateKey)}: ${availability.label}`);
    button.setAttribute("aria-pressed", dateKey === selectedDate ? "true" : "false");
    if (dateKey === selectedDate) button.classList.add("is-selected");
    button.innerHTML = `<span class="calendar-day-number">${day}</span><span class="calendar-day-status">${availability.label}</span>`;

    if (availability.isBookable) button.addEventListener("click", () => selectDate(dateKey));
    calendarGrid.appendChild(button);
  }
}

function resetSelectedSlot() {
  selectedTimeSlot = null;
  if (preferredTimeSlotInput) preferredTimeSlotInput.value = "";
  if (selectedSlotLabel) {
    selectedSlotLabel.textContent = "No time slot selected yet.";
    selectedSlotLabel.dataset.type = "";
  }
}

function selectDate(dateKey) {
  selectedDate = dateKey;
  resetSelectedSlot();
  if (preferredDateInput) preferredDateInput.value = dateKey;
  if (selectedDateLabel) {
    selectedDateLabel.textContent = `Selected date: ${formatDisplayDate(dateKey)}`;
    selectedDateLabel.dataset.type = "selected";
  }
  renderCalendar();
  renderTimeSlots();
}

function renderTimeSlots() {
  if (!bookingSlotGrid) return;
  bookingSlotGrid.innerHTML = "";

  if (!selectedDate) {
    bookingSlotGrid.innerHTML = '<p class="slot-placeholder">Choose an available date first.</p>';
    return;
  }

  const slots = getAvailableSlots(selectedDate);
  if (!slots.length) {
    bookingSlotGrid.innerHTML = '<p class="slot-placeholder">No available time slots for this date. Please choose another date.</p>';
    return;
  }

  slots.forEach((slot) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "booking-slot-btn";
    button.dataset.slotId = slot.id;
    button.innerHTML = `<strong>${slot.label}</strong><span>${slot.start} to ${slot.end}</span>`;
    button.setAttribute("aria-pressed", selectedTimeSlot?.id === slot.id ? "true" : "false");
    if (selectedTimeSlot?.id === slot.id) button.classList.add("is-selected");

    button.addEventListener("click", () => {
      selectedTimeSlot = slot;
      if (preferredTimeSlotInput) preferredTimeSlotInput.value = slot.id;
      if (selectedSlotLabel) {
        selectedSlotLabel.textContent = `Selected time: ${slot.label}`;
        selectedSlotLabel.dataset.type = "selected";
      }
      renderTimeSlots();
    });

    bookingSlotGrid.appendChild(button);
  });
}

async function getFirebaseModules() {
  if (!firebaseModulesPromise) {
    firebaseModulesPromise = Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js"),
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js")
    ]).then(([configModule, firestoreModule, storageModule]) => ({
      db: configModule.db,
      app: configModule.app,
      collection: firestoreModule.collection,
      doc: firestoreModule.doc,
      setDoc: firestoreModule.setDoc,
      serverTimestamp: firestoreModule.serverTimestamp,
      getDocs: firestoreModule.getDocs,
      query: firestoreModule.query,
      where: firestoreModule.where,
      documentId: firestoreModule.documentId,
      getStorage: storageModule.getStorage,
      storageRef: storageModule.ref,
      uploadBytes: storageModule.uploadBytes
    }));
  }
  return firebaseModulesPromise;
}

async function loadAvailabilityForMonth() {
  renderCalendar();
  renderTimeSlots();
  availabilityByDate = new Map();

  try {
    const { db, collection, getDocs, query, where, documentId } = await getFirebaseModules();
    const firstDay = toDateKey(calendarMonth);
    const lastDay = toDateKey(getMonthEnd(calendarMonth));
    const monthQuery = query(collection(db, "availability"), where(documentId(), ">=", firstDay), where(documentId(), "<=", lastDay));
    const snapshot = await getDocs(monthQuery);
    snapshot.forEach((item) => availabilityByDate.set(item.id, item.data()));
  } catch (error) {
    console.error("Error loading availability:", error);
    showMessage("Could not load availability from Firestore. Please refresh or try again.", "error");
  }

  renderCalendar();
  renderTimeSlots();
}

function toggleConditionalPanels() {
  const hasExemption = exemptionToggle?.checked === true;
  const animalConcern = animalsOnPropertyInput?.checked === true || animalsOffLeashInput?.checked === true;
  if (exemptionPanel) exemptionPanel.classList.toggle("is-visible", hasExemption);
  if (animalPanel) animalPanel.classList.toggle("is-visible", animalConcern);
}

function normaliseAustralianMobile(value) {
  const compact = String(value || "").replace(/[\s()-]/g, "");
  if (/^04\d{8}$/.test(compact)) return compact;
  if (/^\+614\d{8}$/.test(compact)) return compact;
  if (/^614\d{8}$/.test(compact)) return `+${compact}`;
  return "";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function validateFile(file) {
  if (!file) return "Please upload the pool exemption document.";
  const allowedTypes = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
  if (!allowedTypes.includes(file.type)) return "The exemption upload must be a PDF, JPG, PNG or WEBP file.";
  if (file.size > maxUploadBytes) return "The exemption upload must be 10 MB or smaller.";
  return "";
}

function sanitizeFileName(name) {
  return String(name || "exemption-file")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cleanText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseStreetType(value) {
  const cleaned = cleanText(value).replace(/\./g, "");
  return STREET_TYPE_MAP[cleaned] || cleaned;
}

function normaliseStreetName(value) {
  return cleanText(value)
    .replace(/\b(STREET|ST|ROAD|RD|AVENUE|AVE|DRIVE|DR|COURT|CT|CRESCENT|CRES|PLACE|PL|PARADE|PDE|TERRACE|TCE|BOULEVARD|BLVD|BVD|CIRCUIT|CCT|CLOSE|CL|LANE|LN|HIGHWAY|HWY|WAY)\b$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseStreetNumber(value) {
  const cleaned = cleanText(value);
  const match = cleaned.match(/\d+[A-Z]?(?:-\d+[A-Z]?)?/);
  return match ? match[0] : cleaned;
}

function splitStreetLine(addressLine1) {
  const cleaned = cleanText(addressLine1);
  const parts = cleaned.split(" ").filter(Boolean);
  let streetNumber = "";
  let streetType = "";
  let streetName = "";

  const numberIndex = parts.findIndex((part) => /\d/.test(part));
  if (numberIndex >= 0) streetNumber = normaliseStreetNumber(parts[numberIndex]);

  const lastPart = parts[parts.length - 1] || "";
  if (STREET_TYPE_MAP[lastPart]) {
    streetType = STREET_TYPE_MAP[lastPart];
    streetName = parts.slice(numberIndex + 1, -1).join(" ");
  } else {
    streetName = parts.slice(numberIndex + 1).join(" ");
  }

  return {
    streetNumber,
    streetName: normaliseStreetName(streetName),
    streetType
  };
}

function getPoolAddressParts(address = {}) {
  const parsed = splitStreetLine(address.addressLine1 || address.formattedAddress || "");
  return {
    streetNumber: normaliseStreetNumber(address.houseNumber || address.housenumber || parsed.streetNumber),
    streetName: normaliseStreetName(address.street || parsed.streetName),
    streetType: normaliseStreetType(address.streetType || parsed.streetType),
    suburb: cleanText(address.suburb || address.city || address.town || address.village),
    postcode: cleanText(address.postcode),
    formattedAddress: address.formattedAddress || ""
  };
}

function recordValue(record, key) {
  return record?.[key] ?? record?.[key.replace(/ /g, " ")] ?? "";
}

function numberMatches(inputNumber, recordNumber) {
  const input = normaliseStreetNumber(inputNumber);
  const record = normaliseStreetNumber(recordNumber);
  if (!input || !record) return false;
  if (input === record) return true;
  const inputDigits = input.match(/\d+/)?.[0] || "";
  const recordDigits = record.match(/\d+/)?.[0] || "";
  return Boolean(inputDigits && recordDigits && inputDigits === recordDigits);
}

function scorePoolRecord(parts, record) {
  let score = 0;
  const recordStreetNumber = recordValue(record, "Street Number");
  const recordStreetName = recordValue(record, "Street Name");
  const recordStreetType = recordValue(record, "Street Type");
  const recordSuburb = recordValue(record, "Suburb");
  const recordPostcode = recordValue(record, "Post Code");

  if (parts.postcode && cleanText(recordPostcode) === parts.postcode) score += 25;
  if (parts.suburb && cleanText(recordSuburb) === parts.suburb) score += 25;
  if (parts.streetName && normaliseStreetName(recordStreetName) === parts.streetName) score += 30;
  if (parts.streetType && normaliseStreetType(recordStreetType) === parts.streetType) score += 10;
  if (numberMatches(parts.streetNumber, recordStreetNumber)) score += 40;
  return score;
}

function formatPoolRecordAddress(record) {
  const unitNumber = cleanText(recordValue(record, "Unit Number"));
  const streetNumber = cleanText(recordValue(record, "Street Number"));
  const streetName = cleanText(recordValue(record, "Street Name"));
  const streetType = cleanText(recordValue(record, "Street Type"));
  const suburb = cleanText(recordValue(record, "Suburb"));
  const postcode = cleanText(recordValue(record, "Post Code"));
  const unitPrefix = unitNumber ? `UNIT ${unitNumber}/` : "";
  return `${unitPrefix}${streetNumber} ${streetName} ${streetType}, ${suburb} ${postcode}`.replace(/\s+/g, " ").trim();
}

async function fetchPoolRecordsWithFilters(filters, q = "") {
  const params = new URLSearchParams({
    resource_id: QLD_POOL_REGISTER_RESOURCE_ID,
    limit: "1000",
    filters: JSON.stringify(filters)
  });
  if (q) params.set("q", q);

  const response = await fetch(`${QLD_DATASTORE_SEARCH_URL}?${params.toString()}`, {
    headers: { "Accept": "application/json" }
  });
  if (!response.ok) throw new Error(`Queensland Open Data returned HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.success) throw new Error("Queensland Open Data lookup was not successful");
  return data.result?.records || [];
}

async function queryQueenslandPoolRegister(parts) {
  const attempts = [];
  if (parts.postcode && parts.suburb) attempts.push({ "Post Code": parts.postcode, "Suburb": parts.suburb });
  if (parts.postcode) attempts.push({ "Post Code": parts.postcode });
  if (parts.suburb) attempts.push({ "Suburb": parts.suburb });

  const seen = new Set();
  const records = [];

  for (const filters of attempts) {
    const batch = await fetchPoolRecordsWithFilters(filters, parts.streetName || "");
    for (const record of batch) {
      const key = String(record._id || JSON.stringify(record));
      if (!seen.has(key)) {
        seen.add(key);
        records.push(record);
      }
    }
    if (records.length) break;
  }

  return records;
}

async function directPoolRegisterLookup(address) {
  const addressParts = getPoolAddressParts(address);
  if (!addressParts.postcode || !addressParts.suburb || !addressParts.streetName) {
    return {
      registered: false,
      status: "insufficient_address",
      reason: "The selected address did not include enough searchable details.",
      addressParts
    };
  }

  const records = await queryQueenslandPoolRegister(addressParts);
  const scored = records
    .map((record) => ({ record, score: scorePoolRecord(addressParts, record) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  const registered = Boolean(best && best.score >= 80);

  if (!registered) {
    return {
      registered: false,
      status: "not_found",
      reason: "No matching registered pool was found for the selected address.",
      addressParts,
      checkedRecordCount: records.length,
      bestScore: best?.score || 0
    };
  }

  const record = best.record;
  return {
    registered: true,
    status: "registered",
    matchConfidence: best.score,
    matchedAddress: formatPoolRecordAddress(record),
    siteName: recordValue(record, "Site Name") || "",
    unitNumber: recordValue(record, "Unit Number") || "",
    streetNumber: recordValue(record, "Street Number") || "",
    streetName: recordValue(record, "Street Name") || "",
    streetType: recordValue(record, "Street Type") || "",
    suburb: recordValue(record, "Suburb") || "",
    postcode: recordValue(record, "Post Code") || "",
    numberOfPools: recordValue(record, "Number of Pools") || "",
    localGovernmentArea: recordValue(record, "Local Government Authority Area") || "",
    sharedPoolProperty: recordValue(record, "Shared Pool Property") || "",
    source: "Queensland Government Open Data Pool safety register"
  };
}

function injectPoolRegisterStyles() {
  if (document.querySelector("#pool-register-styles")) return;
  const style = document.createElement("style");
  style.id = "pool-register-styles";
  style.textContent = `
    .pool-register-panel { margin-top: 12px; padding: 16px; border-radius: 18px; border: 1px solid rgba(7,24,52,.10); background: #f9fbfe; display: grid; gap: 14px; }
    .pool-register-panel[data-status="registered"] { background: #eefbf3; border-color: rgba(15,138,67,.28); }
    .pool-register-panel[data-status="not_found"] { background: #fff1f1; border-color: rgba(214,31,31,.24); }
    .pool-register-panel[data-status="manual_required"], .pool-register-panel[data-status="checking"] { background: #fff7ed; border-color: rgba(234,88,12,.24); }
    .pool-register-header { display: flex; gap: 12px; align-items: flex-start; }
    .pool-register-icon { width: 34px; height: 34px; border-radius: 999px; display: inline-grid; place-items: center; color: #fff; background: #ea580c; font-weight: 900; flex: 0 0 auto; }
    .pool-register-panel[data-status="registered"] .pool-register-icon { background: #0f8a43; }
    .pool-register-panel[data-status="not_found"] .pool-register-icon { background: #d61f1f; }
    .pool-register-title { color: var(--navy); display: block; font-weight: 900; margin-bottom: 3px; }
    .pool-register-text, .pool-register-details { color: var(--muted); font-weight: 750; line-height: 1.45; }
    .pool-register-details { padding: 12px 14px; border-radius: 14px; background: rgba(255,255,255,.72); border: 1px solid rgba(7,24,52,.06); }
    .pool-register-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .pool-register-actions a, .pool-register-actions button { text-decoration: none; }
  `;
  document.head.appendChild(style);
}

function getContinuationElements() {
  if (!form) return [];

  const sections = [...form.querySelectorAll(".form-section")];
  const propertySection = form.querySelector('[aria-labelledby="property-details-heading"]');
  const propertySectionIndex = sections.indexOf(propertySection);
  const elements = [];

  if (propertySection) {
    elements.push(...propertySection.querySelectorAll(".field-grid > label:not(.address-field-wrap), .option-stack"));
  }

  if (propertySectionIndex >= 0) elements.push(...sections.slice(propertySectionIndex + 1));
  else elements.push(...sections.slice(2));

  if (submitButton) elements.push(submitButton);
  return elements;
}

function canContinueAfterPoolRegisterCheck() {
  const addressSelected = addressSelectedInput?.value === "true";
  if (!addressSelected) return false;
  if (poolRegisterStatus === "registered") return poolRegisterLooksRight;
  if (poolRegisterStatus === "not_found" || poolRegisterStatus === "manual_required") return poolRegisterOverrideConfirmed;
  return false;
}

function updateContinuationVisibility() {
  const canContinue = canContinueAfterPoolRegisterCheck();
  getContinuationElements().forEach((element) => {
    element.hidden = !canContinue;
  });
}

function createPoolRegisterPanel() {
  if (!addressStatus || poolRegisterPanel) return;
  injectPoolRegisterStyles();
  poolRegisterPanel = document.createElement("div");
  poolRegisterPanel.className = "pool-register-panel";
  poolRegisterPanel.hidden = true;
  addressStatus.insertAdjacentElement("afterend", poolRegisterPanel);
}

function renderPoolRegisterPanel() {
  createPoolRegisterPanel();
  if (!poolRegisterPanel) return;

  if (poolRegisterStatus === "not_checked") {
    poolRegisterPanel.hidden = true;
    updateContinuationVisibility();
    return;
  }

  poolRegisterPanel.hidden = false;
  poolRegisterPanel.dataset.status = poolRegisterStatus;

  let icon = "!";
  let title = "Pool register verification";
  let text = "";
  let details = "";
  let body = "";
  let actions = "";

  if (poolRegisterStatus === "checking") {
    title = "Checking pool registration";
    text = "Checking the selected address against the Queensland pool register. Please wait.";
  } else if (poolRegisterStatus === "registered") {
    icon = "✓";
    title = "Registered pool found";
    text = "A registered pool was found for this address. Does this look right?";
    details = poolRegisterDetails?.summary || poolRegisterDetails?.matchedAddress || "Registered pool details matched the selected address.";
    body = `
      <div class="option-stack">
        <label class="option-card">
          <input type="checkbox" id="poolRegisterLooksRight" ${poolRegisterLooksRight ? "checked" : ""} />
          <span>Yes, this looks right.</span>
        </label>
      </div>`;
    actions = `<div class="pool-register-actions"><button class="btn btn-secondary" type="button" id="pool-register-edit-address">Edit address</button></div>`;
  } else if (poolRegisterStatus === "not_found") {
    icon = "×";
    title = "No registered pool found";
    text = "We could not find a registered pool for this selected address. Try another address, check/register the pool with QBCC, or use the fail-safe if you know there is a pool at this property.";
    details = "Address matching can fail because of unit numbers, spelling, street abbreviations, lot/plan details, or register data differences.";
    body = `
      <div class="option-stack">
        <label class="option-card">
          <input type="checkbox" id="poolRegisterOverride" ${poolRegisterOverrideConfirmed ? "checked" : ""} />
          <span>There is a pool at this property. Continue anyway.<small>Use this only if the lookup is wrong, unavailable, or the pool is listed under slightly different address details.</small></span>
        </label>
      </div>`;
    actions = `<div class="pool-register-actions"><a class="btn btn-primary" href="${QBCC_POOL_REGISTER_URL}" target="_blank" rel="noopener">Check or register with QBCC</a><button class="btn btn-secondary" type="button" id="pool-register-edit-address">Try another address</button></div>`;
  } else {
    title = "Pool register verification unavailable";
    text = "Automatic verification could not be completed. Try another address, check/register the pool with QBCC, or use the fail-safe if you know there is a pool at this property.";
    details = "The direct Queensland Open Data lookup could not be completed from this browser session. A genuine booking can still continue using the fail-safe.";
    body = `
      <div class="option-stack">
        <label class="option-card">
          <input type="checkbox" id="poolRegisterOverride" ${poolRegisterOverrideConfirmed ? "checked" : ""} />
          <span>There is a pool at this property. Continue anyway.<small>Use this only if the register check is wrong, unavailable, or the pool is listed under slightly different address details.</small></span>
        </label>
      </div>`;
    actions = `<div class="pool-register-actions"><a class="btn btn-primary" href="${QBCC_POOL_REGISTER_URL}" target="_blank" rel="noopener">Check or register with QBCC</a><button class="btn btn-secondary" type="button" id="pool-register-edit-address">Try another address</button></div>`;
  }

  poolRegisterPanel.innerHTML = `
    <div class="pool-register-header">
      <span class="pool-register-icon">${icon}</span>
      <div>
        <strong class="pool-register-title">${escapeHtml(title)}</strong>
        <div class="pool-register-text">${escapeHtml(text)}</div>
      </div>
    </div>
    ${details ? `<div class="pool-register-details">${escapeHtml(details)}</div>` : ""}
    ${body}
    ${actions}
  `;

  const looksRightInput = poolRegisterPanel.querySelector("#poolRegisterLooksRight");
  if (looksRightInput) {
    looksRightInput.addEventListener("change", () => {
      poolRegisterLooksRight = looksRightInput.checked;
      updateContinuationVisibility();
    });
  }

  const overrideInput = poolRegisterPanel.querySelector("#poolRegisterOverride");
  if (overrideInput) {
    overrideInput.addEventListener("change", () => {
      poolRegisterOverrideConfirmed = overrideInput.checked;
      updateContinuationVisibility();
    });
  }

  const editButton = poolRegisterPanel.querySelector("#pool-register-edit-address");
  if (editButton) {
    editButton.addEventListener("click", () => {
      if (addressInput) {
        addressInput.focus();
        addressInput.select();
      }
      selectedAddress = null;
      if (addressSelectedInput) addressSelectedInput.value = "false";
      if (propertyPlaceIdInput) propertyPlaceIdInput.value = "";
      resetPoolRegisterState();
      setAddressStatus("Edit the address, then select the correct suggestion.", "");
    });
  }

  updateContinuationVisibility();
}

function setPoolRegisterState(status, message = "", details = null) {
  poolRegisterStatus = status;
  poolRegisterMessage = message;
  poolRegisterDetails = details;
  poolRegisterCheckedAt = status === "not_checked" ? null : new Date().toISOString();
  renderPoolRegisterPanel();
}

function resetPoolRegisterState() {
  poolRegisterStatus = "not_checked";
  poolRegisterMessage = "";
  poolRegisterDetails = null;
  poolRegisterCheckedAt = null;
  poolRegisterLooksRight = false;
  poolRegisterOverrideConfirmed = false;
  renderPoolRegisterPanel();
}

async function verifyPoolRegistration() {
  if (!selectedAddress) return;
  poolRegisterLooksRight = false;
  poolRegisterOverrideConfirmed = false;
  setPoolRegisterState("checking", "Checking pool registration");

  try {
    let result;
    if (POOL_REGISTER_LOOKUP_ENDPOINT) {
      const response = await fetch(POOL_REGISTER_LOOKUP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: selectedAddress })
      });
      if (!response.ok) throw new Error(`Pool register lookup failed: ${response.status}`);
      result = await response.json();
    } else {
      result = await directPoolRegisterLookup(selectedAddress);
    }

    if (result?.registered === true) {
      const detailParts = [
        result.matchedAddress || "Registered pool found",
        result.numberOfPools ? `${result.numberOfPools} registered pool${Number(result.numberOfPools) === 1 ? "" : "s"}` : "",
        result.localGovernmentArea ? `LGA: ${result.localGovernmentArea}` : "",
        result.sharedPoolProperty ? `Shared pool: ${result.sharedPoolProperty}` : ""
      ].filter(Boolean);
      setPoolRegisterState("registered", "Registered pool found", {
        ...result,
        summary: detailParts.join(" · ") || "Registered pool found"
      });
      return;
    }

    setPoolRegisterState("not_found", "No registered pool found", result || null);
  } catch (error) {
    console.error("Pool register lookup error:", error);
    setPoolRegisterState("manual_required", "Pool register verification unavailable", { error: error.message });
  }
}

function validateBookingForm() {
  const email = getValue("#email");
  const mobile = normaliseAustralianMobile(getValue("#phone"));
  const hasAddress = getValue("#propertyAddress").length > 8;
  const addressSelected = addressSelectedInput?.value === "true";
  const isOwner = getChecked("#isPropertyOwner");
  const authorised = getChecked("#authorisedToBook");
  const animalsNeedAttention = getChecked("#animalsOnProperty") || getChecked("#animalsOffLeash");
  const hasExemption = getChecked("#hasPoolExemption");
  const exemptionFile = exemptionFileInput?.files?.[0] || null;

  if (!isValidEmail(email)) return "Please enter a valid email address.";
  if (!mobile) return "Please enter a valid Australian mobile number, for example 04XX XXX XXX.";
  if (!hasAddress) return "Please enter the property address.";
  if (!addressSelected) return "Please select the property address from the address suggestions.";

  if (!canContinueAfterPoolRegisterCheck()) {
    if (poolRegisterStatus === "checking") return "Please wait for the pool register check to finish.";
    if (poolRegisterStatus === "registered") return "Please confirm the pool registration information looks right before continuing.";
    return "Please try another address, check/register the pool with QBCC, or confirm there is a pool at this property using the fail-safe option.";
  }

  if (!isOwner && !authorised) return "Please confirm you are the property owner or authorised to arrange the inspection.";
  if (!selectedDate) return "Please choose an available inspection date from the calendar.";
  if (!selectedTimeSlot) return "Please choose one available 1-hour time slot.";
  if (!getChecked("#willBeHomeForInspection") && !getChecked("#accessPermissionIfNotHome")) return "Please confirm whether you will be home or whether access is permitted if you are not home.";
  if (animalsNeedAttention && !getChecked("#animalsWillBeSecured")) return "Please confirm dogs or other animals will be securely restrained away from the inspection area.";
  if (hasExemption) {
    const fileError = validateFile(exemptionFile);
    if (fileError) return fileError;
  }
  if (!getChecked("#nonComplianceAcknowledged")) return "Please acknowledge that a certificate cannot be issued until the pool barrier is compliant.";
  if (!getChecked("#informationAccuracyConfirmed")) return "Please confirm the information provided is accurate.";
  if (!getChecked("#termsAccepted")) return "Please accept the terms, privacy policy and refunds policy.";
  return "";
}

function clearAddressSuggestions() {
  if (!addressSuggestions) return;
  addressSuggestions.innerHTML = "";
  addressSuggestions.hidden = true;
}

function selectGeoapifyAddress(result) {
  selectedAddress = {
    formattedAddress: result.formatted,
    placeId: result.place_id || "",
    latitude: result.lat || null,
    longitude: result.lon || null,
    addressLine1: result.address_line1 || "",
    addressLine2: result.address_line2 || "",
    houseNumber: result.housenumber || result.house_number || "",
    street: result.street || "",
    suburb: result.suburb || result.city || result.town || result.village || "",
    city: result.city || "",
    town: result.town || "",
    village: result.village || "",
    postcode: result.postcode || "",
    state: result.state || "",
    country: result.country || "Australia"
  };

  if (addressInput) addressInput.value = result.formatted;
  if (addressSelectedInput) addressSelectedInput.value = "true";
  if (propertyPlaceIdInput) propertyPlaceIdInput.value = selectedAddress.placeId;
  setAddressStatus("Address selected.", "success");
  clearAddressSuggestions();
  verifyPoolRegistration();
}

function renderAddressSuggestions(results) {
  if (!addressSuggestions) return;
  addressSuggestions.innerHTML = "";

  if (!results.length) {
    addressSuggestions.hidden = true;
    setAddressStatus("No matching Australian addresses found. Try adding the suburb or postcode.", "error");
    return;
  }

  results.forEach((result) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "address-suggestion";
    button.textContent = result.formatted;
    button.addEventListener("click", () => selectGeoapifyAddress(result));
    addressSuggestions.appendChild(button);
  });

  addressSuggestions.hidden = false;
  setAddressStatus("Select the correct address from the suggestions.", "");
}

async function searchGeoapifyAddresses(text) {
  if (!text || text.length < 3) {
    clearAddressSuggestions();
    setAddressStatus("Start typing and select the property address from the suggestions.", "");
    return;
  }

  try {
    const params = new URLSearchParams({
      text,
      filter: "countrycode:au",
      format: "json",
      limit: "6",
      apiKey: GEOAPIFY_API_KEY
    });
    const response = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params.toString()}`);
    if (!response.ok) throw new Error(`Geoapify request failed: ${response.status}`);
    const data = await response.json();
    renderAddressSuggestions(data.results || []);
  } catch (error) {
    console.error("Geoapify address search error:", error);
    clearAddressSuggestions();
    setAddressStatus("Address suggestions could not load. Please try again.", "error");
  }
}

function initAddressAutocomplete() {
  if (!addressInput) return;
  setAddressStatus("Start typing and select the property address from the suggestions.", "");

  addressInput.addEventListener("input", () => {
    selectedAddress = null;
    if (addressSelectedInput) addressSelectedInput.value = "false";
    if (propertyPlaceIdInput) propertyPlaceIdInput.value = "";
    resetPoolRegisterState();
    window.clearTimeout(addressSearchTimer);
    addressSearchTimer = window.setTimeout(() => searchGeoapifyAddresses(addressInput.value.trim()), 300);
  });

  document.addEventListener("click", (event) => {
    if (!addressInput.contains(event.target) && !addressSuggestions?.contains(event.target)) clearAddressSuggestions();
  });
}

function wireBasicEvents() {
  if (calendarPrev) {
    calendarPrev.addEventListener("click", () => {
      calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
      loadAvailabilityForMonth();
    });
  }

  if (calendarNext) {
    calendarNext.addEventListener("click", () => {
      calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
      loadAvailabilityForMonth();
    });
  }

  [exemptionToggle, animalsOnPropertyInput, animalsOffLeashInput].forEach((input) => {
    if (input) input.addEventListener("change", toggleConditionalPanels);
  });
}

async function uploadExemptionIfNeeded(bookingId) {
  const hasExemption = getChecked("#hasPoolExemption");
  const exemptionFile = exemptionFileInput?.files?.[0] || null;
  if (!hasExemption || !exemptionFile) return null;

  const { app, getStorage, storageRef, uploadBytes } = await getFirebaseModules();
  const storage = getStorage(app);
  const fileName = `${Date.now()}-${sanitizeFileName(exemptionFile.name)}`;
  const filePath = `booking-exemptions/${bookingId}/${fileName}`;
  const fileRef = storageRef(storage, filePath);

  await uploadBytes(fileRef, exemptionFile, {
    contentType: exemptionFile.type,
    customMetadata: { bookingId, originalFileName: exemptionFile.name }
  });

  return {
    uploaded: true,
    storagePath: filePath,
    fileName: exemptionFile.name,
    fileType: exemptionFile.type,
    fileSize: exemptionFile.size
  };
}

async function handleBookingSubmit(event) {
  event.preventDefault();
  showMessage("");

  const validationError = validateBookingForm();
  if (validationError) {
    showMessage(validationError, "error");
    return;
  }

  setLoading(true, getChecked("#hasPoolExemption") ? "Uploading..." : "Saving...");

  try {
    const { db, collection, doc, setDoc, serverTimestamp } = await getFirebaseModules();
    const bookingDocRef = doc(collection(db, "bookings"));
    const exemptionFileData = await uploadExemptionIfNeeded(bookingDocRef.id);
    const termsAccepted = getChecked("#termsAccepted");
    const hasExemption = getChecked("#hasPoolExemption");

    setLoading(true, "Saving...");

    const bookingData = {
      customerName: getValue("#customerName"),
      email: getValue("#email"),
      phone: normaliseAustralianMobile(getValue("#phone")),
      propertyAddress: getValue("#propertyAddress"),
      propertyAddressSelected: addressSelectedInput?.value === "true",
      propertyPlaceId: getValue("#propertyPlaceId"),
      selectedAddress,

      poolRegisterStatus,
      poolRegisterMessage,
      poolRegisterDetails,
      poolRegisterCheckedAt,
      poolRegisterLooksRight,
      poolRegisterOverrideConfirmed,
      poolRegisterLookupSource: POOL_REGISTER_LOOKUP_ENDPOINT ? "backend_lookup" : "qld_open_data_direct",

      isPropertyOwner: getChecked("#isPropertyOwner"),
      authorisedToBook: getChecked("#authorisedToBook"),
      clientType: getChecked("#isPropertyOwner") ? "Property owner" : "Authorised representative",
      inspectionReason: getValue("#inspectionReason"),
      poolType: getValue("#poolType"),
      existingCertificateStatus: getValue("#existingCertificateStatus"),
      poolRegisteredStatus: getValue("#poolRegisteredStatus"),

      preferredDate: selectedDate,
      preferredDateDisplay: formatDisplayDate(selectedDate),
      preferredTimeSlot: selectedTimeSlot.id,
      preferredTimeLabel: selectedTimeSlot.label,
      preferredTimeStart: selectedTimeSlot.start,
      preferredTimeEnd: selectedTimeSlot.end,
      preferredTime: selectedTimeSlot.label,

      willBeHomeForInspection: getChecked("#willBeHomeForInspection"),
      accessPermissionIfNotHome: getChecked("#accessPermissionIfNotHome"),
      animalsOnProperty: getChecked("#animalsOnProperty"),
      animalsOffLeash: getChecked("#animalsOffLeash"),
      animalsWillBeSecured: getChecked("#animalsWillBeSecured"),
      accessInstructions: getValue("#accessInstructions"),

      hasPoolExemption: hasExemption,
      exemptionFileUploaded: Boolean(exemptionFileData),
      exemptionFile: exemptionFileData,
      minorRepairsContactAccepted: getChecked("#minorRepairsContactAccepted"),
      nonComplianceAcknowledged: getChecked("#nonComplianceAcknowledged"),
      informationAccuracyConfirmed: getChecked("#informationAccuracyConfirmed"),
      notes: getValue("#notes"),

      serviceName: "Pool Safety Inspection & Certificate",
      priceCents: inspectionPriceCents,
      priceDisplay: inspectionPriceDisplay,
      currency: "aud",
      status: "pending_payment",
      paymentStatus: "unpaid",
      stripeSessionId: null,
      stripePaymentIntentId: null,
      termsAccepted,
      privacyAccepted: termsAccepted,
      source: "website_booking_form",
      createdAt: serverTimestamp(),
      paidAt: null
    };

    await setDoc(bookingDocRef, bookingData);
    showMessage(`Booking saved successfully. Booking ID: ${bookingDocRef.id}`, "success");

    form.reset();
    selectedDate = "";
    selectedAddress = null;
    if (addressSelectedInput) addressSelectedInput.value = "false";
    if (propertyPlaceIdInput) propertyPlaceIdInput.value = "";
    setAddressStatus("Start typing and select the property address from the suggestions.", "");
    resetPoolRegisterState();
    resetSelectedSlot();
    toggleConditionalPanels();
    if (preferredDateInput) preferredDateInput.value = "";
    if (selectedDateLabel) {
      selectedDateLabel.textContent = "No date selected yet.";
      selectedDateLabel.dataset.type = "";
    }
    renderCalendar();
    renderTimeSlots();
    console.log("Booking saved:", bookingDocRef.id);
  } catch (error) {
    console.error("Error saving booking:", error);
    showMessage("We could not save the booking. Please refresh and try again, or call IronGate on 0481 442 260.", "error");
  } finally {
    setLoading(false);
  }
}

if (form) form.addEventListener("submit", handleBookingSubmit);
wireBasicEvents();
initAddressAutocomplete();
toggleConditionalPanels();
loadAvailabilityForMonth();
renderPoolRegisterPanel();
