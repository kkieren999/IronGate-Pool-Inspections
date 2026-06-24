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

const inspectionPriceCents = 24900;
const inspectionPriceDisplay = "$249 inc GST";
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let selectedDate = "";
let selectedTimeSlot = null;
let availabilityByDate = new Map();
let calendarMonth = startOfMonth(new Date());
let firebaseModulesPromise = null;

if (priceNotice) {
  priceNotice.textContent = `Pool Safety Inspection & Certificate — ${inspectionPriceDisplay}`;
}

function getValue(selector) {
  const element = document.querySelector(selector);
  return element ? element.value.trim() : "";
}

function setLoading(isLoading) {
  if (!submitButton) return;
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "Saving..." : "Save Booking Test";
}

function showMessage(text, type = "") {
  if (!message) return;
  message.textContent = text;
  message.dataset.type = type;
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
  const [year, month, day] = dateKey.split("-").map(Number);
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
  const [hours, minutes] = time.split(":").map(Number);
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

  let rawSlots = [];
  if (Array.isArray(saved.slots)) {
    rawSlots = saved.slots;
  } else if (typeof saved.slots === "object") {
    rawSlots = Object.values(saved.slots);
  }

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

  if (isPastDate(date)) {
    return { status: "unavailable", label: "Past date", isBookable: false };
  }

  if (availableSlots.length > 0) {
    return {
      status: "available",
      label: `${availableSlots.length} time${availableSlots.length === 1 ? "" : "s"}`,
      isBookable: true
    };
  }

  if (saved?.reason) {
    return { status: "unavailable", label: saved.reason, isBookable: false };
  }

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

    if (dateKey === selectedDate) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

    button.innerHTML = `
      <span class="calendar-day-number">${day}</span>
      <span class="calendar-day-status">${availability.label}</span>
    `;

    if (availability.isBookable) {
      button.addEventListener("click", () => selectDate(dateKey));
    }

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

    if (selectedTimeSlot?.id === slot.id) {
      button.classList.add("is-selected");
      button.setAttribute("aria-pressed", "true");
    } else {
      button.setAttribute("aria-pressed", "false");
    }

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
      import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js")
    ]).then(([configModule, firestoreModule]) => ({
      db: configModule.db,
      collection: firestoreModule.collection,
      addDoc: firestoreModule.addDoc,
      serverTimestamp: firestoreModule.serverTimestamp,
      getDocs: firestoreModule.getDocs,
      query: firestoreModule.query,
      where: firestoreModule.where,
      documentId: firestoreModule.documentId
    }));
  }

  return firebaseModulesPromise;
}

async function loadAvailabilityForMonth() {
  renderCalendar();
  renderTimeSlots();

  const firstDay = toDateKey(calendarMonth);
  const lastDay = toDateKey(getMonthEnd(calendarMonth));
  availabilityByDate = new Map();

  try {
    const { db, collection, getDocs, query, where, documentId } = await getFirebaseModules();

    const monthQuery = query(
      collection(db, "availability"),
      where(documentId(), ">=", firstDay),
      where(documentId(), "<=", lastDay)
    );

    const snapshot = await getDocs(monthQuery);
    snapshot.forEach((doc) => {
      availabilityByDate.set(doc.id, doc.data());
    });
  } catch (error) {
    console.error("Error loading availability:", error);
    showMessage("Could not load availability from Firestore. Please refresh or try again.", "error");
  }

  renderCalendar();
  renderTimeSlots();
}

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

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    showMessage("");

    if (!selectedDate) {
      showMessage("Please choose an available inspection date from the calendar.", "error");
      if (selectedDateLabel) {
        selectedDateLabel.textContent = "Please choose an available inspection date.";
        selectedDateLabel.dataset.type = "error";
      }
      return;
    }

    if (!selectedTimeSlot) {
      showMessage("Please choose one available 1-hour time slot.", "error");
      if (selectedSlotLabel) {
        selectedSlotLabel.textContent = "Please choose one available 1-hour time slot.";
        selectedSlotLabel.dataset.type = "error";
      }
      return;
    }

    setLoading(true);

    const termsAccepted = document.querySelector("#termsAccepted")?.checked === true;

    const bookingData = {
      customerName: getValue("#customerName"),
      email: getValue("#email"),
      phone: getValue("#phone"),
      propertyAddress: getValue("#propertyAddress"),
      clientType: getValue("#clientType"),
      preferredDate: selectedDate,
      preferredDateDisplay: formatDisplayDate(selectedDate),
      preferredTimeSlot: selectedTimeSlot.id,
      preferredTimeLabel: selectedTimeSlot.label,
      preferredTimeStart: selectedTimeSlot.start,
      preferredTimeEnd: selectedTimeSlot.end,
      preferredTime: selectedTimeSlot.label,
      accessInstructions: getValue("#accessInstructions"),
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
      createdAt: null,
      paidAt: null
    };

    try {
      const { db, collection, addDoc, serverTimestamp } = await getFirebaseModules();
      bookingData.createdAt = serverTimestamp();

      const docRef = await addDoc(collection(db, "bookings"), bookingData);
      showMessage(`Booking saved successfully. Booking ID: ${docRef.id}`, "success");
      form.reset();
      selectedDate = "";
      resetSelectedSlot();
      if (preferredDateInput) preferredDateInput.value = "";
      if (selectedDateLabel) {
        selectedDateLabel.textContent = "No date selected yet.";
        selectedDateLabel.dataset.type = "";
      }
      renderCalendar();
      renderTimeSlots();
      console.log("Booking saved:", docRef.id);
    } catch (error) {
      console.error("Error saving booking:", error);
      showMessage("Something went wrong. Please check your Firestore rules, internet connection and browser console.", "error");
    } finally {
      setLoading(false);
    }
  });
}

loadAvailabilityForMonth();
