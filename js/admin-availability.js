import { app, db } from "./firebase-config.js";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";

const SLOT_DEFINITIONS = [
  { id: "08_00", start: "08:00", end: "09:00", label: "8:00 AM – 9:00 AM" },
  { id: "09_00", start: "09:00", end: "10:00", label: "9:00 AM – 10:00 AM" },
  { id: "10_00", start: "10:00", end: "11:00", label: "10:00 AM – 11:00 AM" },
  { id: "11_00", start: "11:00", end: "12:00", label: "11:00 AM – 12:00 PM" },
  { id: "12_00", start: "12:00", end: "13:00", label: "12:00 PM – 1:00 PM" },
  { id: "13_00", start: "13:00", end: "14:00", label: "1:00 PM – 2:00 PM" },
  { id: "14_00", start: "14:00", end: "15:00", label: "2:00 PM – 3:00 PM" },
  { id: "15_00", start: "15:00", end: "16:00", label: "3:00 PM – 4:00 PM" },
  { id: "16_00", start: "16:00", end: "17:00", label: "4:00 PM – 5:00 PM" }
];

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const auth = getAuth(app);

const loginCard = document.querySelector("#admin-login-card");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const loginSubmit = document.querySelector("#admin-login-submit");
const signOutButton = document.querySelector("#admin-signout");
const consolePanel = document.querySelector("#admin-console");
const connectionStatus = document.querySelector("#admin-connection-status");

const calendarGrid = document.querySelector("#admin-calendar-grid");
const calendarTitle = document.querySelector("#admin-calendar-title");
const prevMonthButton = document.querySelector("#admin-prev-month");
const nextMonthButton = document.querySelector("#admin-next-month");

const selectedHeading = document.querySelector("#admin-editor-heading");
const selectedHelp = document.querySelector("#admin-selected-help");
const availabilityForm = document.querySelector("#availability-form");
const availabilityDateInput = document.querySelector("#availability-date");
const noteInput = document.querySelector("#availability-note");
const reasonInput = document.querySelector("#availability-reason");
const saveButton = document.querySelector("#save-availability");
const deleteButton = document.querySelector("#delete-availability");
const availabilityMessage = document.querySelector("#availability-message");
const slotGrid = document.querySelector("#admin-slot-grid");
const slotSummaryNumber = document.querySelector("#slot-summary-number");
const slotSummaryText = document.querySelector("#slot-summary-text");
const presetButtons = document.querySelectorAll("[data-preset]");

const bulkForm = document.querySelector("#bulk-form");
const bulkStartInput = document.querySelector("#bulk-start");
const bulkEndInput = document.querySelector("#bulk-end");
const bulkPresetInput = document.querySelector("#bulk-preset");
const bulkNoteInput = document.querySelector("#bulk-note");
const bulkWeekdaysOnlyInput = document.querySelector("#bulk-weekdays-only");
const bulkSaveButton = document.querySelector("#bulk-save");
const bulkDeleteButton = document.querySelector("#bulk-delete");
const bulkMessage = document.querySelector("#bulk-message");

let calendarMonth = startOfMonth(new Date());
let selectedDate = "";
let currentSlots = makePresetSlots("standard");
let availabilityByDate = new Map();
let unsubscribeAvailability = null;

function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getAuthErrorMessage(error) {
  const code = error?.code || "unknown";

  const messages = {
    "auth/invalid-email": "That email address is not valid.",
    "auth/invalid-credential": "The email or password is incorrect. This is the most common Firebase error after adding the user.",
    "auth/user-not-found": "No Firebase Authentication user exists with that email in this Firebase project.",
    "auth/wrong-password": "The password is incorrect.",
    "auth/operation-not-allowed": "Email/Password sign-in is not enabled in Firebase Authentication → Sign-in method.",
    "auth/unauthorized-domain": "This website domain is not authorised in Firebase Authentication → Settings → Authorised domains.",
    "auth/network-request-failed": "Network error. Check your internet connection or try again.",
    "auth/too-many-requests": "Firebase has temporarily blocked sign-in attempts. Wait a few minutes, then try again."
  };

  return `${messages[code] || "Sign in failed."} Firebase code: ${code}`;
}

function setText(element, text, type = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.type = type;
}

function setButtonLoading(button, isLoading, loadingText, normalText) {
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = isLoading ? loadingText : normalText;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDisplayDate(dateKey) {
  if (!dateKey) return "No date selected";
  return parseDateKey(dateKey).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function isWeekend(date) {
  return date.getDay() === 0 || date.getDay() === 6;
}

function isPastDate(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);
  return compare < today;
}

function cloneSlot(definition, available = true) {
  return {
    id: definition.id,
    start: definition.start,
    end: definition.end,
    label: definition.label,
    available,
    booked: false
  };
}

function makePresetSlots(preset) {
  return SLOT_DEFINITIONS.reduce((slots, definition) => {
    let available = true;

    if (preset === "morning") {
      available = ["08_00", "09_00", "10_00", "11_00"].includes(definition.id);
    } else if (preset === "afternoon") {
      available = ["12_00", "13_00", "14_00", "15_00", "16_00"].includes(definition.id);
    } else if (preset === "closed") {
      available = false;
    }

    slots[definition.id] = cloneSlot(definition, available);
    return slots;
  }, {});
}

function normaliseSavedSlots(saved, date) {
  if (saved?.slots && typeof saved.slots === "object") {
    return SLOT_DEFINITIONS.reduce((slots, definition) => {
      const savedSlot = saved.slots[definition.id] || {};
      slots[definition.id] = {
        ...cloneSlot(definition, savedSlot.available === true),
        booked: savedSlot.booked === true
      };
      return slots;
    }, {});
  }

  if (saved?.status === "unavailable" || saved?.status === "fully_booked") {
    return makePresetSlots("closed");
  }

  if (saved?.status === "available") {
    return makePresetSlots("standard");
  }

  if (isWeekend(date) || isPastDate(date)) {
    return makePresetSlots("closed");
  }

  return makePresetSlots("standard");
}

function getAvailableSlotCount(slots) {
  return Object.values(slots || {}).filter((slot) => slot.available && !slot.booked).length;
}

function getDaySummary(dateKey, date) {
  const saved = availabilityByDate.get(dateKey);
  const slots = normaliseSavedSlots(saved, date);
  const availableCount = getAvailableSlotCount(slots);

  if (isPastDate(date)) {
    return { className: "past", label: "Past", availableCount, saved };
  }

  if (availableCount > 0) {
    return {
      className: saved ? "available" : "default",
      label: `${availableCount} slot${availableCount === 1 ? "" : "s"}`,
      availableCount,
      saved
    };
  }

  if (!saved && isWeekend(date)) {
    return { className: "default-unavailable", label: "Weekend", availableCount, saved };
  }

  return { className: "unavailable", label: saved?.reason || "No slots", availableCount, saved };
}

function renderCalendar() {
  if (!calendarGrid || !calendarTitle) return;

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const daysInMonth = getMonthEnd(calendarMonth).getDate();
  const firstWeekday = calendarMonth.getDay();

  calendarTitle.textContent = `${monthNames[month]} ${year}`;
  calendarGrid.innerHTML = "";

  for (let index = 0; index < firstWeekday; index += 1) {
    const emptyCell = document.createElement("span");
    emptyCell.className = "admin-calendar-empty";
    calendarGrid.appendChild(emptyCell);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = toDateKey(date);
    const summary = getDaySummary(dateKey, date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-day admin-day--${summary.className}`;
    button.dataset.date = dateKey;
    button.setAttribute("aria-label", `${formatDisplayDate(dateKey)}: ${summary.label}`);

    if (dateKey === selectedDate) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.innerHTML = `
      <span class="admin-day-number">${day}</span>
      <span class="admin-day-status">${summary.label}</span>
      ${summary.saved ? '<span class="admin-day-dot">Saved</span>' : '<span class="admin-day-dot admin-day-dot--default">Default</span>'}
    `;

    button.addEventListener("click", () => selectDate(dateKey));
    calendarGrid.appendChild(button);
  }
}

function setEditorEnabled(enabled) {
  [noteInput, reasonInput, saveButton, deleteButton].forEach((element) => {
    if (element) element.disabled = !enabled;
  });
  presetButtons.forEach((button) => {
    button.disabled = !enabled;
  });
  if (slotGrid) {
    slotGrid.querySelectorAll("button").forEach((button) => {
      button.disabled = !enabled;
    });
  }
}

function renderSlotSummary() {
  const availableCount = getAvailableSlotCount(currentSlots);
  if (slotSummaryNumber) slotSummaryNumber.textContent = String(availableCount);
  if (slotSummaryText) {
    slotSummaryText.textContent = availableCount === 1 ? "available slot" : "available slots";
  }
}

function renderSlotGrid() {
  if (!slotGrid) return;

  slotGrid.innerHTML = "";
  SLOT_DEFINITIONS.forEach((definition) => {
    const slot = currentSlots[definition.id] || cloneSlot(definition, false);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-slot-toggle ${slot.available ? "is-on" : "is-off"}`;
    button.disabled = !selectedDate;
    button.setAttribute("aria-pressed", String(slot.available));
    button.innerHTML = `
      <span>${definition.label}</span>
      <strong>${slot.available ? "Available" : "Off"}</strong>
    `;
    button.addEventListener("click", () => {
      currentSlots[definition.id] = {
        ...cloneSlot(definition, !slot.available),
        booked: slot.booked === true
      };
      renderSlotGrid();
      renderSlotSummary();
    });
    slotGrid.appendChild(button);
  });
}

function selectDate(dateKey) {
  selectedDate = dateKey;
  const saved = availabilityByDate.get(dateKey) || {};
  const date = parseDateKey(dateKey);

  currentSlots = normaliseSavedSlots(saved, date);
  availabilityDateInput.value = dateKey;
  selectedHeading.textContent = formatDisplayDate(dateKey);
  selectedHelp.textContent = saved.slots || saved.status
    ? "This date has saved Firebase availability. Toggle the 1-hour slots below and save changes."
    : "No Firebase override yet. The slots below show your default weekday pattern. Save to create an override.";

  noteInput.value = saved.note || "";
  reasonInput.value = saved.reason || "";

  setEditorEnabled(true);
  setText(availabilityMessage, "");
  renderSlotGrid();
  renderSlotSummary();
  renderCalendar();
}

function buildAvailabilityData(dateKey, slots, note, reason) {
  const availableSlotCount = getAvailableSlotCount(slots);
  const status = availableSlotCount > 0 ? "available" : "unavailable";

  return {
    date: dateKey,
    status,
    available: availableSlotCount > 0,
    availableSlotCount,
    slots,
    note: note || (availableSlotCount > 0 ? "Available time slots" : ""),
    reason: reason || (availableSlotCount === 0 ? "No available slots" : ""),
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || "admin"
  };
}

function applyPresetToCurrentSlots(preset) {
  currentSlots = makePresetSlots(preset);
  if (preset === "closed" && reasonInput && !reasonInput.value.trim()) {
    reasonInput.value = "Closed / unavailable";
  }
  if (preset !== "closed" && noteInput && !noteInput.value.trim()) {
    noteInput.value = "Available time slots";
  }
  renderSlotGrid();
  renderSlotSummary();
}

async function saveSelectedAvailability(event) {
  event.preventDefault();

  const dateKey = availabilityDateInput.value;
  if (!dateKey) {
    setText(availabilityMessage, "Please select a date first.", "error");
    return;
  }

  setButtonLoading(saveButton, true, "Saving...", "Save slots");
  setText(availabilityMessage, "");

  try {
    const data = buildAvailabilityData(
      dateKey,
      currentSlots,
      noteInput.value.trim(),
      reasonInput.value.trim()
    );

    await setDoc(doc(db, "availability", dateKey), data, { merge: true });
    setText(availabilityMessage, "Saved. The booking page will now show only the available slots.", "success");
  } catch (error) {
    console.error("Save availability error:", error);
    setText(availabilityMessage, "Could not save. Check you are signed in and your Firestore rules are published.", "error");
  } finally {
    setButtonLoading(saveButton, false, "Saving...", "Save slots");
  }
}

async function deleteSelectedAvailability() {
  const dateKey = availabilityDateInput.value;
  if (!dateKey) {
    setText(availabilityMessage, "Please select a date first.", "error");
    return;
  }

  const confirmDelete = window.confirm(`Delete the saved availability override for ${formatDisplayDate(dateKey)}?`);
  if (!confirmDelete) return;

  deleteButton.disabled = true;
  setText(availabilityMessage, "Deleting...");

  try {
    await deleteDoc(doc(db, "availability", dateKey));
    setText(availabilityMessage, "Deleted. This date now uses the default calendar rule.", "success");
  } catch (error) {
    console.error("Delete availability error:", error);
    setText(availabilityMessage, "Could not delete. Check your Firestore rules and sign in.", "error");
  } finally {
    deleteButton.disabled = false;
  }
}

function datesInRange(startKey, endKey, weekdaysOnly) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  const dates = [];

  if (start > end) return dates;

  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    const copy = new Date(current);
    if (weekdaysOnly && isWeekend(copy)) continue;
    dates.push(toDateKey(copy));
  }

  return dates;
}

function slotsForBulkPreset(preset) {
  if (preset === "selected") {
    if (!selectedDate) return null;
    return JSON.parse(JSON.stringify(currentSlots));
  }
  return makePresetSlots(preset);
}

async function applyBulkAvailability(event) {
  event.preventDefault();

  const startKey = bulkStartInput.value;
  const endKey = bulkEndInput.value;
  const dateKeys = datesInRange(startKey, endKey, bulkWeekdaysOnlyInput.checked);
  const preset = bulkPresetInput.value;
  const slots = slotsForBulkPreset(preset);

  if (!slots) {
    setText(bulkMessage, "Choose a date first before using Copy selected day.", "error");
    return;
  }

  if (!dateKeys.length) {
    setText(bulkMessage, "No dates found in that range.", "error");
    return;
  }

  if (dateKeys.length > 90) {
    setText(bulkMessage, "Please choose 90 days or fewer at a time.", "error");
    return;
  }

  setButtonLoading(bulkSaveButton, true, "Applying...", "Apply slots to range");
  setText(bulkMessage, "");

  try {
    const batch = writeBatch(db);
    dateKeys.forEach((dateKey) => {
      const slotsCopy = JSON.parse(JSON.stringify(slots));
      const data = buildAvailabilityData(
        dateKey,
        slotsCopy,
        bulkNoteInput.value.trim(),
        preset === "closed" ? (bulkNoteInput.value.trim() || "Closed / unavailable") : ""
      );
      batch.set(doc(db, "availability", dateKey), data, { merge: true });
    });

    await batch.commit();
    setText(bulkMessage, `Updated ${dateKeys.length} date${dateKeys.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error("Bulk save error:", error);
    setText(bulkMessage, "Could not update the range. Check your sign in and Firestore rules.", "error");
  } finally {
    setButtonLoading(bulkSaveButton, false, "Applying...", "Apply slots to range");
  }
}

async function deleteBulkAvailability() {
  const startKey = bulkStartInput.value;
  const endKey = bulkEndInput.value;
  const dateKeys = datesInRange(startKey, endKey, bulkWeekdaysOnlyInput.checked);

  if (!dateKeys.length) {
    setText(bulkMessage, "No dates found in that range.", "error");
    return;
  }

  if (dateKeys.length > 90) {
    setText(bulkMessage, "Please choose 90 days or fewer at a time.", "error");
    return;
  }

  const confirmDelete = window.confirm(`Delete availability overrides for ${dateKeys.length} date${dateKeys.length === 1 ? "" : "s"}?`);
  if (!confirmDelete) return;

  bulkDeleteButton.disabled = true;
  setText(bulkMessage, "Deleting range overrides...");

  try {
    const batch = writeBatch(db);
    dateKeys.forEach((dateKey) => {
      batch.delete(doc(db, "availability", dateKey));
    });

    await batch.commit();
    setText(bulkMessage, `Deleted ${dateKeys.length} override${dateKeys.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error("Bulk delete error:", error);
    setText(bulkMessage, "Could not delete the range. Check your sign in and Firestore rules.", "error");
  } finally {
    bulkDeleteButton.disabled = false;
  }
}

function subscribeToAvailability() {
  if (unsubscribeAvailability) unsubscribeAvailability();

  const firstDay = toDateKey(calendarMonth);
  const lastDay = toDateKey(getMonthEnd(calendarMonth));

  const monthQuery = query(
    collection(db, "availability"),
    where(documentId(), ">=", firstDay),
    where(documentId(), "<=", lastDay)
  );

  unsubscribeAvailability = onSnapshot(monthQuery, (snapshot) => {
    availabilityByDate = new Map();
    snapshot.forEach((item) => {
      availabilityByDate.set(item.id, item.data());
    });
    renderCalendar();
    if (selectedDate) {
      const saved = availabilityByDate.get(selectedDate);
      if (saved?.slots) {
        currentSlots = normaliseSavedSlots(saved, parseDateKey(selectedDate));
        noteInput.value = saved.note || noteInput.value || "";
        reasonInput.value = saved.reason || reasonInput.value || "";
        renderSlotGrid();
        renderSlotSummary();
      }
    }
  }, (error) => {
    console.error("Availability listener error:", error);
    setText(connectionStatus, "Could not read availability", "error");
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = normaliseEmail(document.querySelector("#admin-email")?.value);
    const password = document.querySelector("#admin-password")?.value || "";

    setText(loginMessage, "");
    setButtonLoading(loginSubmit, true, "Signing in...", "Sign in");

    if (email !== ADMIN_EMAIL) {
      setText(loginMessage, `This admin console is locked to ${ADMIN_EMAIL}.`, "error");
      setButtonLoading(loginSubmit, false, "Signing in...", "Sign in");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      setText(loginMessage, "Signed in.", "success");
    } catch (error) {
      console.error("Admin login error:", error);
      setText(loginMessage, getAuthErrorMessage(error), "error");
    } finally {
      setButtonLoading(loginSubmit, false, "Signing in...", "Sign in");
    }
  });
}

if (signOutButton) {
  signOutButton.addEventListener("click", async () => {
    await signOut(auth);
  });
}

if (prevMonthButton) {
  prevMonthButton.addEventListener("click", () => {
    calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
    subscribeToAvailability();
    renderCalendar();
  });
}

if (nextMonthButton) {
  nextMonthButton.addEventListener("click", () => {
    calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
    subscribeToAvailability();
    renderCalendar();
  });
}

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyPresetToCurrentSlots(button.dataset.preset);
  });
});

if (availabilityForm) {
  availabilityForm.addEventListener("submit", saveSelectedAvailability);
}

if (deleteButton) {
  deleteButton.addEventListener("click", deleteSelectedAvailability);
}

if (bulkForm) {
  bulkForm.addEventListener("submit", applyBulkAvailability);
}

if (bulkDeleteButton) {
  bulkDeleteButton.addEventListener("click", deleteBulkAvailability);
}

onAuthStateChanged(auth, (user) => {
  const isAdmin = user && normaliseEmail(user.email) === ADMIN_EMAIL;

  if (isAdmin) {
    loginCard.hidden = true;
    consolePanel.hidden = false;
    signOutButton.hidden = false;
    setText(connectionStatus, `Signed in as ${user.email}`, "success");
    subscribeToAvailability();
    renderCalendar();
    renderSlotGrid();
    renderSlotSummary();
  } else {
    if (unsubscribeAvailability) unsubscribeAvailability();
    availabilityByDate = new Map();
    selectedDate = "";
    loginCard.hidden = false;
    consolePanel.hidden = true;
    signOutButton.hidden = true;
    setText(connectionStatus, user ? "Wrong admin account" : "Not signed in", user ? "error" : "");
    setEditorEnabled(false);
  }
});
