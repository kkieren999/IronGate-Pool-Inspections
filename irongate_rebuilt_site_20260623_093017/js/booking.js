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
const exemptionToggle = document.querySelector("#hasPoolExemption");
const exemptionPanel = document.querySelector("#exemption-upload-panel");
const exemptionFileInput = document.querySelector("#exemptionFile");
const animalsOnPropertyInput = document.querySelector("#animalsOnProperty");
const animalsOffLeashInput = document.querySelector("#animalsOffLeash");
const animalPanel = document.querySelector("#animal-restraint-panel");

const inspectionPriceCents = 24900;
const inspectionPriceDisplay = "$249 inc GST";
const maxUploadBytes = 10 * 1024 * 1024;

// Add your Google Places API key here to activate address suggestions.
// The form is already wired for Google Places Autocomplete.
const GOOGLE_PLACES_API_KEY = "";

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
let googlePlacesReady = false;

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
  if (googlePlacesReady && !addressSelected) return "Please select the property address from the address suggestions.";

  if (!isOwner && !authorised) {
    return "Please confirm you are the property owner or authorised to arrange the inspection.";
  }

  if (!selectedDate) return "Please choose an available inspection date from the calendar.";
  if (!selectedTimeSlot) return "Please choose one available 1-hour time slot.";

  if (!getChecked("#willBeHomeForInspection") && !getChecked("#accessPermissionIfNotHome")) {
    return "Please confirm whether you will be home or whether access is permitted if you are not home.";
  }

  if (animalsNeedAttention && !getChecked("#animalsWillBeSecured")) {
    return "Please confirm dogs or other animals will be securely restrained away from the inspection area.";
  }

  if (hasExemption) {
    const fileError = validateFile(exemptionFile);
    if (fileError) return fileError;
  }

  if (!getChecked("#nonComplianceAcknowledged")) {
    return "Please acknowledge that a certificate cannot be issued until the pool barrier is compliant.";
  }

  if (!getChecked("#informationAccuracyConfirmed")) {
    return "Please confirm the information provided is accurate.";
  }

  if (!getChecked("#termsAccepted")) {
    return "Please accept the terms, privacy policy and refunds policy.";
  }

  return "";
}

function initAddressAutocomplete() {
  if (!addressInput) return;

  addressInput.addEventListener("input", () => {
    selectedAddress = null;
    if (addressSelectedInput) addressSelectedInput.value = "false";
    if (propertyPlaceIdInput) propertyPlaceIdInput.value = "";
    if (googlePlacesReady) {
      setAddressStatus("Please select the property address from the suggestions.", "");
    }
  });

  if (!GOOGLE_PLACES_API_KEY) {
    googlePlacesReady = false;
    setAddressStatus("Address autocomplete is ready, but a Google Places API key still needs to be added. Manual address entry is temporarily accepted.", "");
    return;
  }

  window.initIrongateAddressAutocomplete = () => {
    if (!window.google?.maps?.places || !addressInput) return;

    googlePlacesReady = true;
    const autocomplete = new window.google.maps.places.Autocomplete(addressInput, {
      componentRestrictions: { country: "au" },
      fields: ["formatted_address", "place_id", "address_components", "geometry", "name"],
      types: ["address"]
    });

    autocomplete.addListener("place_changed", () => {
      const place = autocomplete.getPlace();
      if (!place?.formatted_address || !place?.place_id) {
        selectedAddress = null;
        if (addressSelectedInput) addressSelectedInput.value = "false";
        setAddressStatus("Please select a full address from the suggestions.", "error");
        return;
      }

      selectedAddress = {
        formattedAddress: place.formatted_address,
        placeId: place.place_id,
        latitude: place.geometry?.location?.lat?.() || null,
        longitude: place.geometry?.location?.lng?.() || null
      };

      addressInput.value = place.formatted_address;
      if (addressSelectedInput) addressSelectedInput.value = "true";
      if (propertyPlaceIdInput) propertyPlaceIdInput.value = place.place_id;
      setAddressStatus("Address selected.", "success");
    });

    setAddressStatus("Start typing and select the property address from the suggestions.", "");
  };

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_PLACES_API_KEY)}&libraries=places&callback=initIrongateAddressAutocomplete`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    googlePlacesReady = false;
    setAddressStatus("Address suggestions could not load. Check the Google Places API key.", "error");
  };
  document.head.appendChild(script);
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

[exemptionToggle, animalsOnPropertyInput, animalsOffLeashInput].forEach((input) => {
  if (input) input.addEventListener("change", toggleConditionalPanels);
});

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    showMessage("");

    const validationError = validateBookingForm();
    if (validationError) {
      showMessage(validationError, "error");
      return;
    }

    setLoading(true, getChecked("#hasPoolExemption") ? "Uploading..." : "Saving...");

    const termsAccepted = getChecked("#termsAccepted");
    const mobile = normaliseAustralianMobile(getValue("#phone"));
    const hasExemption = getChecked("#hasPoolExemption");
    const exemptionFile = exemptionFileInput?.files?.[0] || null;

    try {
      const {
        db,
        app,
        collection,
        doc,
        setDoc,
        serverTimestamp,
        getStorage,
        storageRef,
        uploadBytes
      } = await getFirebaseModules();

      const bookingDocRef = doc(collection(db, "bookings"));
      let exemptionFileData = null;

      if (hasExemption && exemptionFile) {
        setLoading(true, "Uploading file...");
        const storage = getStorage(app);
        const fileName = `${Date.now()}-${sanitizeFileName(exemptionFile.name)}`;
        const filePath = `booking-exemptions/${bookingDocRef.id}/${fileName}`;
        const fileRef = storageRef(storage, filePath);

        await uploadBytes(fileRef, exemptionFile, {
          contentType: exemptionFile.type,
          customMetadata: {
            bookingId: bookingDocRef.id,
            originalFileName: exemptionFile.name
          }
        });

        exemptionFileData = {
          uploaded: true,
          storagePath: filePath,
          fileName: exemptionFile.name,
          fileType: exemptionFile.type,
          fileSize: exemptionFile.size
        };
      }

      setLoading(true, "Saving...");

      const bookingData = {
        customerName: getValue("#customerName"),
        email: getValue("#email"),
        phone: mobile,
        propertyAddress: getValue("#propertyAddress"),
        propertyAddressSelected: addressSelectedInput?.value === "true",
        propertyPlaceId: getValue("#propertyPlaceId"),
        selectedAddress,

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
      setAddressStatus(GOOGLE_PLACES_API_KEY ? "Start typing and select the property address from the suggestions." : "Manual address entry is temporarily accepted until Google Places is connected.", "");
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
      showMessage("Something went wrong. Please check Firebase rules, Storage rules, internet connection and browser console.", "error");
    } finally {
      setLoading(false);
    }
  });
}

initAddressAutocomplete();
toggleConditionalPanels();
loadAvailabilityForMonth();
