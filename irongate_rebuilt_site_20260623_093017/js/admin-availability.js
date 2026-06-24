import { app, db } from "./firebase-config.js";
import {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDocs,
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
const statusInput = document.querySelector("#availability-status");
const maxBookingsInput = document.querySelector("#max-bookings");
const bookedCountInput = document.querySelector("#booked-count");
const noteInput = document.querySelector("#availability-note");
const reasonInput = document.querySelector("#availability-reason");
const saveButton = document.querySelector("#save-availability");
const deleteButton = document.querySelector("#delete-availability");
const availabilityMessage = document.querySelector("#availability-message");

const bulkForm = document.querySelector("#bulk-form");
const bulkStartInput = document.querySelector("#bulk-start");
const bulkEndInput = document.querySelector("#bulk-end");
const bulkStatusInput = document.querySelector("#bulk-status");
const bulkNoteInput = document.querySelector("#bulk-note");
const bulkWeekdaysOnlyInput = document.querySelector("#bulk-weekdays-only");
const bulkSaveButton = document.querySelector("#bulk-save");
const bulkDeleteButton = document.querySelector("#bulk-delete");
const bulkMessage = document.querySelector("#bulk-message");

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let calendarMonth = startOfMonth(new Date());
let selectedDate = "";
let availabilityByDate = new Map();
let unsubscribeAvailability = null;

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

function getDefaultStatus(date) {
  if (isPastDate(date)) {
    return { status: "past", label: "Past", className: "past" };
  }

  if (isWeekend(date)) {
    return { status: "default_unavailable", label: "Weekend", className: "default-unavailable" };
  }

  return { status: "default_available", label: "Default", className: "default" };
}

function normaliseSavedStatus(dateKey, date) {
  const saved = availabilityByDate.get(dateKey);
  if (!saved) return getDefaultStatus(date);

  const status = String(saved.status || "available").toLowerCase();
  const maxBookings = Number(saved.maxBookings || 1);
  const bookedCount = Number(saved.bookedCount || 0);

  if (status === "unavailable" || saved.available === false) {
    return {
      status: "unavailable",
      label: saved.reason || "Unavailable",
      className: "unavailable"
    };
  }

  if (status === "fully_booked" || status === "fully-booked" || status === "full" || bookedCount >= maxBookings) {
    return {
      status: "fully_booked",
      label: "Fully booked",
      className: "full"
    };
  }

  return {
    status: "available",
    label: saved.note || "Available",
    className: "available"
  };
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
    const saved = availabilityByDate.get(dateKey);
    const status = normaliseSavedStatus(dateKey, date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `admin-day admin-day--${status.className}`;
    button.dataset.date = dateKey;
    button.setAttribute("aria-label", `${formatDisplayDate(dateKey)}: ${status.label}`);

    if (dateKey === selectedDate) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.innerHTML = `
      <span class="admin-day-number">${day}</span>
      <span class="admin-day-status">${status.label}</span>
      ${saved ? '<span class="admin-day-dot">Saved</span>' : ''}
    `;

    button.addEventListener("click", () => selectDate(dateKey));
    calendarGrid.appendChild(button);
  }
}

function setEditorEnabled(enabled) {
  [statusInput, maxBookingsInput, bookedCountInput, noteInput, reasonInput, saveButton, deleteButton].forEach((element) => {
    if (element) element.disabled = !enabled;
  });
}

function selectDate(dateKey) {
  selectedDate = dateKey;
  const saved = availabilityByDate.get(dateKey) || {};
  const date = parseDateKey(dateKey);
  const defaultStatus = getDefaultStatus(date);

  availabilityDateInput.value = dateKey;
  selectedHeading.textContent = formatDisplayDate(dateKey);
  selectedHelp.textContent = saved.status
    ? "This date has a saved Firebase override. Edit it below or delete the override to return to the default calendar."
    : `No Firebase override yet. Current default is ${defaultStatus.label.toLowerCase()}. Save below to create one.`;

  statusInput.value = saved.status || (defaultStatus.status === "default_unavailable" || defaultStatus.status === "past" ? "unavailable" : "available");
  maxBookingsInput.value = saved.maxBookings || 1;
  bookedCountInput.value = saved.bookedCount || 0;
  noteInput.value = saved.note || "";
  reasonInput.value = saved.reason || "";

  setEditorEnabled(true);
  setText(availabilityMessage, "");
  renderCalendar();
}

function buildAvailabilityData(dateKey, status, note, reason, maxBookings, bookedCount) {
  const data = {
    date: dateKey,
    status,
    maxBookings: Number(maxBookings) || 1,
    bookedCount: Number(bookedCount) || 0,
    note: note || "",
    reason: reason || "",
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || "admin"
  };

  if (status === "available") {
    data.available = true;
    if (!data.note) data.note = "Available";
  } else if (status === "unavailable") {
    data.available = false;
    if (!data.reason) data.reason = "Unavailable";
  } else if (status === "fully_booked") {
    data.available = false;
    data.bookedCount = data.maxBookings;
    if (!data.reason) data.reason = "Fully booked";
  }

  return data;
}

async function saveSelectedAvailability(event) {
  event.preventDefault();

  const dateKey = availabilityDateInput.value;
  if (!dateKey) {
    setText(availabilityMessage, "Please select a date first.", "error");
    return;
  }

  setButtonLoading(saveButton, true, "Saving...", "Save date");
  setText(availabilityMessage, "");

  try {
    const data = buildAvailabilityData(
      dateKey,
      statusInput.value,
      noteInput.value.trim(),
      reasonInput.value.trim(),
      maxBookingsInput.value,
      bookedCountInput.value
    );

    await setDoc(doc(db, "availability", dateKey), data, { merge: true });
    setText(availabilityMessage, "Saved. The booking calendar will use this availability.", "success");
  } catch (error) {
    console.error("Save availability error:", error);
    setText(availabilityMessage, "Could not save. Check you are signed in and your Firestore rules are published.", "error");
  } finally {
    setButtonLoading(saveButton, false, "Saving...", "Save date");
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

async function applyBulkAvailability(event) {
  event.preventDefault();

  const startKey = bulkStartInput.value;
  const endKey = bulkEndInput.value;
  const dateKeys = datesInRange(startKey, endKey, bulkWeekdaysOnlyInput.checked);

  if (!dateKeys.length) {
    setText(bulkMessage, "No dates found in that range.", "error");
    return;
  }

  if (dateKeys.length > 60) {
    setText(bulkMessage, "Please choose 60 days or fewer at a time.", "error");
    return;
  }

  setButtonLoading(bulkSaveButton, true, "Applying...", "Apply range");
  setText(bulkMessage, "");

  try {
    const batch = writeBatch(db);
    dateKeys.forEach((dateKey) => {
      const data = buildAvailabilityData(
        dateKey,
        bulkStatusInput.value,
        bulkStatusInput.value === "available" ? bulkNoteInput.value.trim() : "",
        bulkStatusInput.value !== "available" ? bulkNoteInput.value.trim() : "",
        1,
        bulkStatusInput.value === "fully_booked" ? 1 : 0
      );
      batch.set(doc(db, "availability", dateKey), data, { merge: true });
    });

    await batch.commit();
    setText(bulkMessage, `Updated ${dateKeys.length} date${dateKeys.length === 1 ? "" : "s"}.`, "success");
  } catch (error) {
    console.error("Bulk save error:", error);
    setText(bulkMessage, "Could not update the range. Check your sign in and Firestore rules.", "error");
  } finally {
    setButtonLoading(bulkSaveButton, false, "Applying...", "Apply range");
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

  if (dateKeys.length > 60) {
    setText(bulkMessage, "Please choose 60 days or fewer at a time.", "error");
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

function listenToMonthAvailability() {
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
    snapshot.forEach((document) => {
      availabilityByDate.set(document.id, document.data());
    });

    renderCalendar();

    if (selectedDate) {
      const selectedMonth = selectedDate.slice(0, 7);
      const currentMonth = toDateKey(calendarMonth).slice(0, 7);
      if (selectedMonth === currentMonth) {
        const saved = availabilityByDate.get(selectedDate);
        if (saved) {
          selectedHelp.textContent = "This date has a saved Firebase override. Edit it below or delete the override to return to the default calendar.";
        }
      }
    }
  }, (error) => {
    console.error("Availability listener error:", error);
    setText(connectionStatus, "Calendar read failed", "error");
  });
}

function goToMonth(offset) {
  calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1));
  selectedDate = "";
  setEditorEnabled(false);
  selectedHeading.textContent = "No date selected";
  selectedHelp.textContent = "Choose a date from the calendar to edit its availability.";
  setText(availabilityMessage, "");
  renderCalendar();
  listenToMonthAvailability();
}

function showAdminConsole(user) {
  const isAllowedAdmin = normaliseEmail(user?.email) === normaliseEmail(ADMIN_EMAIL);

  if (!isAllowedAdmin) {
    loginCard.hidden = false;
    consolePanel.hidden = true;
    signOutButton.hidden = false;
    setText(connectionStatus, "Signed in with wrong email", "error");
    setText(loginMessage, `You are signed in as ${user.email}, but this console is restricted to ${ADMIN_EMAIL}.`, "error");
    return;
  }

  loginCard.hidden = true;
  consolePanel.hidden = false;
  signOutButton.hidden = false;
  setText(connectionStatus, `Signed in: ${user.email}`, "success");
  renderCalendar();
  listenToMonthAvailability();
}

function showLogin() {
  loginCard.hidden = false;
  consolePanel.hidden = true;
  signOutButton.hidden = true;
  setEditorEnabled(false);
  setText(connectionStatus, "Not signed in", "");
  if (unsubscribeAvailability) unsubscribeAvailability();
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setButtonLoading(loginSubmit, true, "Signing in...", "Sign in");
    setText(loginMessage, "");

    try {
      await signInWithEmailAndPassword(
        auth,
        normaliseEmail(document.querySelector("#admin-email").value),
        document.querySelector("#admin-password").value
      );
      loginForm.reset();
    } catch (error) {
      console.error("Admin sign in error:", error);
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
  prevMonthButton.addEventListener("click", () => goToMonth(-1));
}

if (nextMonthButton) {
  nextMonthButton.addEventListener("click", () => goToMonth(1));
}

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
  if (user) {
    showAdminConsole(user);
  } else {
    showLogin();
  }
});

renderCalendar();
