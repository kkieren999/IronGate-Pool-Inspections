const form = document.querySelector("#booking-form");
const message = document.querySelector("#booking-message");
const submitButton = document.querySelector("#booking-submit");
const priceNotice = document.querySelector("#booking-price-notice");
const calendarGrid = document.querySelector("#calendar-grid");
const calendarTitle = document.querySelector("#calendar-title");
const calendarPrev = document.querySelector("#calendar-prev");
const calendarNext = document.querySelector("#calendar-next");
const preferredDateInput = document.querySelector("#preferredDate");
const selectedDateLabel = document.querySelector("#selected-date-label");

const inspectionPriceCents = 24900;
const inspectionPriceDisplay = "$249 inc GST";
const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let selectedDate = "";
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

function normaliseAvailability(dateKey, date) {
  const saved = availabilityByDate.get(dateKey) || {};
  const status = String(saved.status || "").toLowerCase();
  const maxBookings = Number(saved.maxBookings || 1);
  const bookedCount = Number(saved.bookedCount || 0);

  if (isPastDate(date)) {
    return {
      status: "unavailable",
      label: "Past date",
      isBookable: false
    };
  }

  if (status === "unavailable" || saved.available === false) {
    return {
      status: "unavailable",
      label: saved.reason || "Unavailable",
      isBookable: false
    };
  }

  if (status === "fully_booked" || status === "full" || bookedCount >= maxBookings) {
    return {
      status: "fully-booked",
      label: "Fully booked",
      isBookable: false
    };
  }

  if (!saved.status && isWeekend(date)) {
    return {
      status: "unavailable",
      label: "Weekend unavailable",
      isBookable: false
    };
  }

  return {
    status: "available",
    label: saved.note || "Available",
    isBookable: true
  };
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

function selectDate(dateKey) {
  selectedDate = dateKey;
  if (preferredDateInput) preferredDateInput.value = dateKey;
  if (selectedDateLabel) {
    selectedDateLabel.textContent = `Selected date: ${formatDisplayDate(dateKey)}`;
    selectedDateLabel.dataset.type = "selected";
  }
  renderCalendar();
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
  // Show the default calendar immediately so the page never gets stuck on Loading calendar.
  renderCalendar();

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
    showMessage("Calendar is showing the default weekday availability. Firestore availability overrides could not be loaded.", "error");
  }

  renderCalendar();
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
      preferredTime: getValue("#preferredTime"),
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
      if (preferredDateInput) preferredDateInput.value = "";
      if (selectedDateLabel) {
        selectedDateLabel.textContent = "No date selected yet.";
        selectedDateLabel.dataset.type = "";
      }
      renderCalendar();
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
