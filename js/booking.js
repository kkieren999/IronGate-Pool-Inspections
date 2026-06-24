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

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
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

function defaultSlotsForDate(date) {
  if (isPastDate(date) || isWeekend(date)) return [];
  return SLOT_DEFINITIONS.map((slot) => cloneSlot(slot, true));
}

function normaliseSlots(saved, date) {
  if (isPastDate(date)) return [];

  if (saved?.status === "unavailable" || saved?.status === "fully_booked") {
    return [];
  }

  if (saved?.slots && typeof saved.slots === "object") {
    return SLOT_DEFINITIONS.map((definition) => {
      const savedSlot = saved.slots[definition.id] || {};
      return {
        ...cloneSlot(definition, savedSlot.available === true),
        booked: savedSlot.booked === true
      };
    });
  }

  if (saved?.status === "available") {
    return SLOT_DEFINITIONS.map((slot) => cloneSlot(slot, true));
  }

  return defaultSlotsForDate(date);
}

function getAvailableSlots(dateKey) {
  if (!dateKey) return [];
  const date = parseDateKey(dateKey);
  const saved = availabilityByDate.get(dateKey) || null;
  return normaliseSlots(saved, date).filter((slot) => slot.available && !slot.booked);
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
      label: `${availableSlots.length} slot${availableSlots.length === 1 ? "" : "s"}`,
      isBookable: true
    };
  }

  if (saved?.reason) {
    return { status: "unavailable", label: saved.reason, isBookable: false };
  }

  if (!saved && isWeekend(date)) {
    return { status: "unavailable", label: "Weekend unavailable", isBookable: false };
  }

  return { status: "unavailable", label: "No slots", isBookable: false };
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
    button.textContent = slot.label;

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
    const {
      db,
      collection,
      getDocs,
      query,
      where,
      documentId
    } = await getFirebaseModules();

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
    showMessage("Calendar is showing the default weekday slots. Firestore availability overrides could not be loaded.", "error");
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
      const {
        db,
        collection,
        addDoc,
        serverTimestamp
      } = await getFirebaseModules();

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
