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
const clearSlotsButton = document.querySelector("#clear-current-slots");
const availabilityMessage = document.querySelector("#availability-message");
const slotStartInput = document.querySelector("#slot-start-time");
const addSlotButton = document.querySelector("#add-slot-btn");
const slotList = document.querySelector("#admin-slot-list");
const slotSummaryNumber = document.querySelector("#slot-summary-number");
const slotSummaryText = document.querySelector("#slot-summary-text");
const quickAddButtons = document.querySelectorAll("[data-quick-start]");

const bulkForm = document.querySelector("#bulk-form");
const bulkStartInput = document.querySelector("#bulk-start");
const bulkEndInput = document.querySelector("#bulk-end");
const bulkStartTimeInput = document.querySelector("#bulk-start-time");
const bulkEndTimeInput = document.querySelector("#bulk-end-time");
const bulkNoteInput = document.querySelector("#bulk-note");
const bulkSaveButton = document.querySelector("#bulk-save");
const bulkDeleteButton = document.querySelector("#bulk-delete");
const bulkMessage = document.querySelector("#bulk-message");

let calendarMonth = startOfMonth(new Date());
let selectedDate = "";
let currentSlots = [];
let availabilityByDate = new Map();
let unsubscribeAvailability = null;

function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getAuthErrorMessage(error) {
  const code = error?.code || "unknown";
  const messages = {
    "auth/invalid-email": "That email address is not valid.",
    "auth/invalid-credential": "The email or password is incorrect.",
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

function isPastDate(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const compare = new Date(date);
  compare.setHours(0, 0, 0, 0);
  return compare < today;
}

function minutesFromTime(time) {
  const [hours, minutes] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTimeLabel(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function makeSlot(startTime) {
  const startMinutes = minutesFromTime(startTime);
  if (startMinutes === null) throw new Error("Invalid start time.");
  const endMinutes = startMinutes + 60;
  if (endMinutes > 24 * 60) throw new Error("A 1-hour block cannot finish after midnight.");
  const cleanStart = timeFromMinutes(startMinutes);
  const end = timeFromMinutes(endMinutes);
  const id = cleanStart.replace(":", "_");
  return {
    id,
    start: cleanStart,
    end,
    label: `${formatTimeLabel(cleanStart)} – ${formatTimeLabel(end)}`,
    available: true,
    booked: false
  };
}

function sortSlots(slots) {
  return [...slots].sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start));
}

function normaliseSavedSlots(saved) {
  if (!saved?.slots) return [];

  let rawSlots = [];
  if (Array.isArray(saved.slots)) {
    rawSlots = saved.slots;
  } else if (typeof saved.slots === "object") {
    rawSlots = Object.values(saved.slots);
  }

  return sortSlots(
    rawSlots
      .filter((slot) => slot && slot.available !== false && slot.booked !== true && slot.start)
      .map((slot) => {
        try {
          const cleanSlot = makeSlot(slot.start);
          return {
            ...cleanSlot,
            available: slot.available !== false,
            booked: slot.booked === true
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  );
}

function slotsToMap(slots) {
  return sortSlots(slots).reduce((map, slot) => {
    map[slot.id] = slot;
    return map;
  }, {});
}

function getAvailableSlotsForDate(dateKey) {
  const date = parseDateKey(dateKey);
  if (isPastDate(date)) return [];
  const saved = availabilityByDate.get(dateKey);
  return normaliseSavedSlots(saved);
}

function getDaySummary(dateKey, date) {
  const saved = availabilityByDate.get(dateKey);
  const slots = getAvailableSlotsForDate(dateKey);

  if (isPastDate(date)) {
    return { className: "past", label: "Past", availableCount: 0, saved };
  }

  if (slots.length > 0) {
    return {
      className: "available",
      label: `${slots.length} block${slots.length === 1 ? "" : "s"}`,
      availableCount: slots.length,
      saved
    };
  }

  return { className: "unavailable", label: saved?.reason || "No blocks", availableCount: 0, saved };
}

function renderCalendar() {
  if (!calendarGrid || !calendarTitle) return;

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const todayMonth = startOfMonth(new Date());
  const daysInMonth = getMonthEnd(calendarMonth).getDate();
  const firstWeekday = calendarMonth.getDay();

  calendarTitle.textContent = `${monthNames[month]} ${year}`;
  if (prevMonthButton) prevMonthButton.disabled = calendarMonth <= todayMonth;
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
      <span class="admin-day-dot admin-day-dot--${summary.className}">${summary.saved ? "Saved" : "Empty"}</span>
    `;

    button.addEventListener("click", () => selectDate(dateKey));
    calendarGrid.appendChild(button);
  }
}

function setEditorEnabled(enabled) {
  [noteInput, reasonInput, saveButton, deleteButton, clearSlotsButton, slotStartInput, addSlotButton].forEach((element) => {
    if (element) element.disabled = !enabled;
  });
  quickAddButtons.forEach((button) => {
    button.disabled = !enabled;
  });
}

function renderSlotList() {
  if (!slotList) return;
  slotList.innerHTML = "";

  if (!selectedDate) {
    slotList.innerHTML = '<p class="slot-placeholder">Select a date to add available blocks.</p>';
  } else if (!currentSlots.length) {
    slotList.innerHTML = '<p class="slot-placeholder">No blocks added yet. Add a start time above, then save.</p>';
  } else {
    sortSlots(currentSlots).forEach((slot) => {
      const item = document.createElement("div");
      item.className = "admin-slot-item";
      item.innerHTML = `
        <div>
          <strong>${slot.label}</strong>
          <span>${slot.start} to ${slot.end}</span>
        </div>
        <button type="button" class="admin-remove-slot" data-slot-id="${slot.id}">Remove</button>
      `;
      item.querySelector("button").addEventListener("click", () => removeSlot(slot.id));
      slotList.appendChild(item);
    });
  }

  if (slotSummaryNumber) slotSummaryNumber.textContent = String(currentSlots.length);
  if (slotSummaryText) slotSummaryText.textContent = `available 1-hour block${currentSlots.length === 1 ? "" : "s"}`;
}

function selectDate(dateKey) {
  selectedDate = dateKey;
  const saved = availabilityByDate.get(dateKey) || null;
  currentSlots = normaliseSavedSlots(saved);

  if (availabilityDateInput) availabilityDateInput.value = dateKey;
  if (selectedHeading) selectedHeading.textContent = formatDisplayDate(dateKey);
  if (selectedHelp) selectedHelp.textContent = "Add the 1-hour blocks you are available for this date. Clients can choose one of these blocks.";
  if (noteInput) noteInput.value = saved?.note || "";
  if (reasonInput) reasonInput.value = saved?.reason || "";
  if (slotStartInput) slotStartInput.value = "08:00";

  setEditorEnabled(true);
  setText(availabilityMessage, "");
  renderSlotList();
  renderCalendar();
}

function addSlot(startTime) {
  if (!selectedDate) {
    setText(availabilityMessage, "Choose a date first.", "error");
    return;
  }

  try {
    const newSlot = makeSlot(startTime);
    if (currentSlots.some((slot) => slot.id === newSlot.id)) {
      setText(availabilityMessage, `${newSlot.label} is already added.`, "error");
      return;
    }
    currentSlots = sortSlots([...currentSlots, newSlot]);
    setText(availabilityMessage, `${newSlot.label} added. Remember to save.`, "success");
    renderSlotList();
  } catch (error) {
    setText(availabilityMessage, error.message || "Invalid time block.", "error");
  }
}

function removeSlot(slotId) {
  currentSlots = currentSlots.filter((slot) => slot.id !== slotId);
  setText(availabilityMessage, "Block removed. Remember to save.", "success");
  renderSlotList();
}

function buildDateRange(startKey, endKey) {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (end < start) throw new Error("The end date must be after the start date.");

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function buildSlotsBetween(startTime, endTime) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start === null || end === null) throw new Error("Choose valid start and finish times.");
  if (end <= start) throw new Error("Finish time must be later than start time.");
  if ((end - start) % 60 !== 0) throw new Error("Use full 1-hour blocks only, for example 08:00 to 14:00.");

  const slots = [];
  for (let minute = start; minute < end; minute += 60) {
    slots.push(makeSlot(timeFromMinutes(minute)));
  }
  return slots;
}

async function saveSelectedDate() {
  if (!selectedDate) return;
  setButtonLoading(saveButton, true, "Saving...", "Save available blocks");
  setText(availabilityMessage, "");

  try {
    const slots = sortSlots(currentSlots);
    await setDoc(doc(db, "availability", selectedDate), {
      status: slots.length ? "available" : "unavailable",
      slots: slotsToMap(slots),
      availableCount: slots.length,
      note: noteInput?.value.trim() || "",
      reason: reasonInput?.value.trim() || (slots.length ? "" : "No available blocks"),
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.email || ADMIN_EMAIL
    }, { merge: true });

    setText(availabilityMessage, `${formatDisplayDate(selectedDate)} saved with ${slots.length} block${slots.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error("Error saving availability:", error);
    setText(availabilityMessage, "Could not save availability. Check Firebase rules and sign-in status.", "error");
  } finally {
    setButtonLoading(saveButton, false, "Saving...", "Save available blocks");
  }
}

async function deleteSelectedDate() {
  if (!selectedDate) return;
  const confirmed = window.confirm(`Delete all availability blocks for ${formatDisplayDate(selectedDate)}?`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "availability", selectedDate));
    currentSlots = [];
    if (noteInput) noteInput.value = "";
    if (reasonInput) reasonInput.value = "";
    renderSlotList();
    setText(availabilityMessage, "Date availability deleted. Clients will not see slots for this day.", "success");
  } catch (error) {
    console.error("Error deleting availability:", error);
    setText(availabilityMessage, "Could not delete availability. Check Firebase rules and sign-in status.", "error");
  }
}

function getSelectedBulkDays() {
  return [...document.querySelectorAll(".bulk-day:checked")].map((input) => Number(input.value));
}

async function applyBulkSlots(event) {
  event.preventDefault();
  setText(bulkMessage, "");

  try {
    const startKey = bulkStartInput.value;
    const endKey = bulkEndInput.value;
    const selectedDays = getSelectedBulkDays();
    const slots = buildSlotsBetween(bulkStartTimeInput.value, bulkEndTimeInput.value);

    if (!startKey || !endKey) throw new Error("Choose a start and end date.");
    if (!selectedDays.length) throw new Error("Choose at least one day of the week.");

    const dates = buildDateRange(startKey, endKey).filter((date) => selectedDays.includes(date.getDay()) && !isPastDate(date));
    if (!dates.length) throw new Error("No future dates matched your selected range and days.");

    const confirmed = window.confirm(`Create ${slots.length} block${slots.length === 1 ? "" : "s"} on ${dates.length} date${dates.length === 1 ? "" : "s"}? This will replace availability on those dates.`);
    if (!confirmed) return;

    setButtonLoading(bulkSaveButton, true, "Creating...", "Create blocks for range");

    const batch = writeBatch(db);
    dates.forEach((date) => {
      const dateKey = toDateKey(date);
      batch.set(doc(db, "availability", dateKey), {
        status: "available",
        slots: slotsToMap(slots),
        availableCount: slots.length,
        note: bulkNoteInput.value.trim(),
        reason: "",
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ADMIN_EMAIL
      }, { merge: true });
    });
    await batch.commit();

    setText(bulkMessage, `Created ${slots.length} block${slots.length === 1 ? "" : "s"} on ${dates.length} date${dates.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error("Bulk save error:", error);
    setText(bulkMessage, error.message || "Could not create bulk availability.", "error");
  } finally {
    setButtonLoading(bulkSaveButton, false, "Creating...", "Create blocks for range");
  }
}

async function deleteBulkRange() {
  setText(bulkMessage, "");

  try {
    const startKey = bulkStartInput.value;
    const endKey = bulkEndInput.value;
    const selectedDays = getSelectedBulkDays();
    if (!startKey || !endKey) throw new Error("Choose a start and end date.");
    if (!selectedDays.length) throw new Error("Choose at least one day of the week.");

    const dates = buildDateRange(startKey, endKey).filter((date) => selectedDays.includes(date.getDay()));
    if (!dates.length) throw new Error("No dates matched your selected range and days.");

    const confirmed = window.confirm(`Delete availability for ${dates.length} date${dates.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;

    setButtonLoading(bulkDeleteButton, true, "Deleting...", "Delete range availability");

    const batch = writeBatch(db);
    dates.forEach((date) => batch.delete(doc(db, "availability", toDateKey(date))));
    await batch.commit();

    setText(bulkMessage, `Deleted availability for ${dates.length} date${dates.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error("Bulk delete error:", error);
    setText(bulkMessage, error.message || "Could not delete range availability.", "error");
  } finally {
    setButtonLoading(bulkDeleteButton, false, "Deleting...", "Delete range availability");
  }
}

function subscribeAvailabilityForMonth() {
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
    snapshot.forEach((item) => availabilityByDate.set(item.id, item.data()));
    renderCalendar();
    if (selectedDate) {
      const saved = availabilityByDate.get(selectedDate) || null;
      currentSlots = normaliseSavedSlots(saved);
      renderSlotList();
    }
    setText(connectionStatus, "Connected", "success");
  }, (error) => {
    console.error("Availability listener error:", error);
    setText(connectionStatus, "Firestore read error", "error");
  });
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setText(loginMessage, "");
    setButtonLoading(loginSubmit, true, "Signing in...", "Sign in");

    const email = document.querySelector("#admin-email")?.value || "";
    const password = document.querySelector("#admin-password")?.value || "";

    if (normaliseEmail(email) !== ADMIN_EMAIL) {
      setText(loginMessage, `Use the admin email: ${ADMIN_EMAIL}`, "error");
      setButtonLoading(loginSubmit, false, "Signing in...", "Sign in");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      console.error("Admin login error:", error);
      setText(loginMessage, getAuthErrorMessage(error), "error");
    } finally {
      setButtonLoading(loginSubmit, false, "Signing in...", "Sign in");
    }
  });
}

if (signOutButton) {
  signOutButton.addEventListener("click", () => signOut(auth));
}

if (prevMonthButton) {
  prevMonthButton.addEventListener("click", () => {
    calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
    subscribeAvailabilityForMonth();
  });
}

if (nextMonthButton) {
  nextMonthButton.addEventListener("click", () => {
    calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
    subscribeAvailabilityForMonth();
  });
}

if (addSlotButton) {
  addSlotButton.addEventListener("click", () => addSlot(slotStartInput?.value || "08:00"));
}

quickAddButtons.forEach((button) => {
  button.addEventListener("click", () => addSlot(button.dataset.quickStart));
});

if (clearSlotsButton) {
  clearSlotsButton.addEventListener("click", () => {
    currentSlots = [];
    setText(availabilityMessage, "All blocks cleared. Remember to save.", "success");
    renderSlotList();
  });
}

if (availabilityForm) {
  availabilityForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSelectedDate();
  });
}

if (deleteButton) {
  deleteButton.addEventListener("click", deleteSelectedDate);
}

if (bulkForm) {
  bulkForm.addEventListener("submit", applyBulkSlots);
}

if (bulkDeleteButton) {
  bulkDeleteButton.addEventListener("click", deleteBulkRange);
}

onAuthStateChanged(auth, (user) => {
  const isAdmin = user && normaliseEmail(user.email) === ADMIN_EMAIL;

  if (loginCard) loginCard.hidden = Boolean(isAdmin);
  if (consolePanel) consolePanel.hidden = !isAdmin;
  if (signOutButton) signOutButton.hidden = !isAdmin;

  if (isAdmin) {
    setText(connectionStatus, "Signed in", "success");
    setText(loginMessage, "");
    setEditorEnabled(false);
    renderSlotList();
    subscribeAvailabilityForMonth();
  } else {
    setText(connectionStatus, user ? "Wrong admin email" : "Not signed in", user ? "error" : "");
    if (unsubscribeAvailability) unsubscribeAvailability();
    unsubscribeAvailability = null;
    selectedDate = "";
    currentSlots = [];
    availabilityByDate = new Map();
    setEditorEnabled(false);
    renderCalendar();
  }
});
