import { app, db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const auth = getAuth(app);
const state = {
  bookings: [],
  selectedId: "",
  filter: "upcoming"
};

const $ = (selector) => document.querySelector(selector);

function injectBookingStyles() {
  if ($("#admin-bookings-style")) return;
  const style = document.createElement("style");
  style.id = "admin-bookings-style";
  style.textContent = `
    .console-menu { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .booking-dashboard-grid { display: grid; grid-template-columns: minmax(280px, .85fr) minmax(0, 1.15fr); gap: 22px; align-items: start; }
    .booking-metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 18px 0; }
    .booking-metric { border: 1px solid rgba(7,24,52,.08); border-radius: 18px; background: #f7fbff; padding: 14px; }
    .booking-metric strong { display: block; color: var(--navy); font-size: 1.35rem; }
    .booking-metric span { display: block; color: var(--muted); font-weight: 850; font-size: .82rem; margin-top: 3px; }
    .booking-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px; }
    .booking-filter { border: 1px solid rgba(21,158,232,.28); background: #fff; color: var(--navy); border-radius: 999px; padding: 9px 12px; font-weight: 900; cursor: pointer; }
    .booking-filter[aria-pressed="true"] { background: var(--blue); color: #fff; border-color: var(--blue); }
    .booking-list { display: grid; gap: 10px; max-height: 680px; overflow: auto; padding-right: 4px; }
    .booking-row { width: 100%; border: 1px solid rgba(7,24,52,.08); border-radius: 18px; background: #fff; padding: 14px; text-align: left; cursor: pointer; display: grid; gap: 8px; }
    .booking-row:hover, .booking-row.is-selected { border-color: rgba(21,158,232,.5); background: #f4fbff; }
    .booking-row-top { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
    .booking-row strong { color: var(--navy); }
    .booking-row span, .booking-row small { color: var(--muted); font-weight: 800; }
    .booking-pill-line { display: flex; flex-wrap: wrap; gap: 6px; }
    .booking-pill { display: inline-flex; align-items: center; min-height: 24px; border-radius: 999px; padding: 0 8px; font-size: .72rem; font-weight: 950; background: #eef2f7; color: #334155; }
    .booking-pill.is-paid, .booking-pill.is-confirmed, .booking-pill.is-completed { background: #eafaf0; color: #0f8a43; }
    .booking-pill.is-unpaid, .booking-pill.is-pending { background: #fff7ed; color: #9a3412; }
    .booking-pill.is-cancelled { background: #fff1f1; color: #d61f1f; }
    .booking-detail-empty { padding: 24px; border-radius: 18px; background: #f7fafc; color: var(--muted); font-weight: 800; }
    .booking-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .booking-detail-grid .full { grid-column: 1 / -1; }
    .booking-fact { border: 1px solid rgba(7,24,52,.08); border-radius: 16px; padding: 12px; background: #f9fbfe; }
    .booking-fact span { display: block; color: var(--muted); font-size: .76rem; font-weight: 900; text-transform: uppercase; }
    .booking-fact strong { display: block; color: var(--navy); margin-top: 4px; overflow-wrap: anywhere; }
    .booking-actions-form { margin-top: 18px; display: grid; gap: 14px; }
    .booking-action-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
    .booking-actions-form label { display: grid; gap: 8px; color: var(--navy); font-weight: 850; }
    .booking-actions-form input, .booking-actions-form select, .booking-actions-form textarea { width: 100%; border: 1px solid #d7e1ec; border-radius: 14px; padding: 13px 14px; background: #f9fbfe; font: inherit; }
    .booking-action-buttons { display: flex; flex-wrap: wrap; gap: 10px; }
    @media (max-width: 1050px) { .booking-dashboard-grid, .booking-action-row { grid-template-columns: 1fr; } .booking-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); } .console-menu { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(style);
}

function normaliseEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  const [y, m, d] = String(key || "").split("-").map(Number);
  return new Date(y || 2000, (m || 1) - 1, d || 1);
}

function displayDate(key) {
  if (!key) return "Not set";
  return parseDateKey(key).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function displayDateLong(key) {
  if (!key) return "Not set";
  return parseDateKey(key).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function bookingAvailabilityDate(booking = {}) {
  const date = booking.preferredDate || booking.availabilityLockDate || "";
  return isDateKey(date) ? date : "";
}

function bookingAvailabilitySlot(booking = {}) {
  return booking.preferredTimeSlot || booking.availabilityLockSlot || "";
}

function minutesFromTime(time) {
  const [h, m] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function timeFromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function labelTime(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function makeSlotFromStart(start) {
  const startMinutes = minutesFromTime(start);
  const cleanStart = timeFromMinutes(startMinutes);
  const end = timeFromMinutes(startMinutes + 60);
  return {
    id: cleanStart.replace(":", "_"),
    start: cleanStart,
    end,
    label: `${labelTime(cleanStart)} - ${labelTime(end)}`,
    available: true,
    booked: false
  };
}

function bookingId(booking) {
  return booking?.id || "";
}

function paymentLabel(booking = {}) {
  if (booking.paymentStatus === "paid" || booking.paymentStatus === "agency_invoice") return "Paid";
  if (booking.paymentStatus === "expired") return "Expired";
  if (booking.paymentStatus === "checkout_created") return "Pending payment";
  return booking.paymentStatus || "Unpaid";
}

function inspectionStatus(booking = {}) {
  if (booking.status === "cancelled" || booking.inspectionStatus === "cancelled") return "Cancelled";
  if (booking.inspectionStatus === "certificate_issued" || booking.status === "certificate_issued") return "Certificate issued";
  if (booking.inspectionStatus === "completed" || booking.status === "completed") return "Completed";
  if (booking.preferredDate === todayKey() && (booking.paymentStatus === "paid" || booking.status === "confirmed")) return "Inspection today";
  if (booking.status === "confirmed" || booking.paymentStatus === "paid") return "Confirmed";
  return "Pending payment";
}

function statusClass(label) {
  const clean = String(label || "").toLowerCase();
  if (clean.includes("cancel")) return "is-cancelled";
  if (clean.includes("paid") || clean.includes("confirm") || clean.includes("complete") || clean.includes("certificate")) return "is-paid";
  if (clean.includes("pending") || clean.includes("unpaid") || clean.includes("checkout")) return "is-unpaid";
  return "";
}

function isPaid(booking = {}) {
  return booking.paymentStatus === "paid" || booking.paymentStatus === "agency_invoice";
}

function isCancelled(booking = {}) {
  return booking.status === "cancelled" || booking.inspectionStatus === "cancelled";
}

function isCompleted(booking = {}) {
  return booking.status === "completed" || booking.inspectionStatus === "completed" || booking.status === "certificate_issued" || booking.inspectionStatus === "certificate_issued";
}

function filteredBookings() {
  const today = todayKey();
  return state.bookings.filter((booking) => {
    if (state.filter === "today") return booking.preferredDate === today && !isCancelled(booking);
    if (state.filter === "unpaid") return !isPaid(booking) && !isCancelled(booking);
    if (state.filter === "cancelled") return isCancelled(booking);
    if (state.filter === "completed") return isCompleted(booking);
    if (state.filter === "paid") return isPaid(booking) && !isCancelled(booking) && !isCompleted(booking);
    if (state.filter === "all") return true;
    return booking.preferredDate >= today && !isCancelled(booking) && !isCompleted(booking);
  });
}

function bookingSort(a, b) {
  const dateCompare = String(a.preferredDate || "9999-99-99").localeCompare(String(b.preferredDate || "9999-99-99"));
  if (dateCompare) return dateCompare;
  return minutesFromTime(a.preferredTimeStart || a.preferredTime || "23:59") - minutesFromTime(b.preferredTimeStart || b.preferredTime || "23:59");
}

function selectedBooking() {
  return state.bookings.find((booking) => booking.id === state.selectedId) || null;
}

function setPanelMessage(text, type = "") {
  const el = $("#booking-admin-message");
  if (!el) return;
  el.textContent = text;
  el.dataset.type = type;
}

function insertBookingsPanel() {
  if ($("#tab-bookings") || !$(".console-menu") || !$("#console")) return;
  injectBookingStyles();

  const tab = document.createElement("button");
  tab.className = "console-tab";
  tab.type = "button";
  tab.id = "tab-bookings";
  tab.dataset.tab = "bookings";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("aria-controls", "panel-bookings");
  tab.innerHTML = `<strong>Bookings</strong><span>Manage paid, unpaid, moved, cancelled and completed inspections.</span>`;
  $(".console-menu").appendChild(tab);

  const panel = document.createElement("div");
  panel.className = "admin-panel";
  panel.id = "panel-bookings";
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "tab-bookings");
  panel.hidden = true;
  panel.innerHTML = `
    <section class="admin-card">
      <div class="clean-card-heading">
        <div>
          <p class="section-kicker">Booking Management</p>
          <h2>Inspection dashboard</h2>
          <p class="muted-help">View bookings, move inspections, cancel bookings and mark jobs completed without opening Firestore.</p>
        </div>
        <button class="btn soft-btn" type="button" id="reload-bookings">Reload</button>
      </div>
      <div class="booking-metrics" id="booking-metrics"></div>
      <div class="booking-filters" id="booking-filters" aria-label="Booking filters">
        <button class="booking-filter" type="button" data-booking-filter="upcoming">Upcoming</button>
        <button class="booking-filter" type="button" data-booking-filter="today">Today</button>
        <button class="booking-filter" type="button" data-booking-filter="paid">Paid</button>
        <button class="booking-filter" type="button" data-booking-filter="unpaid">Unpaid</button>
        <button class="booking-filter" type="button" data-booking-filter="cancelled">Cancelled</button>
        <button class="booking-filter" type="button" data-booking-filter="completed">Completed</button>
        <button class="booking-filter" type="button" data-booking-filter="all">All</button>
      </div>
      <p class="form-note" id="booking-admin-message" role="status" aria-live="polite"></p>
    </section>
    <div class="booking-dashboard-grid">
      <section class="admin-card">
        <div class="summary-pill"><strong id="booking-count">0</strong> booking/s</div>
        <div class="booking-list" id="booking-list"></div>
      </section>
      <section class="admin-card" id="booking-detail-card">
        <div class="booking-detail-empty">Choose a booking to view details and actions.</div>
      </section>
    </div>
  `;
  $("#console").appendChild(panel);

  tab.addEventListener("click", () => setActiveBookingsTab());
  $("#reload-bookings").addEventListener("click", loadBookings);
  $("#booking-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-booking-filter]");
    if (!button) return;
    state.filter = button.dataset.bookingFilter;
    renderBookings();
  });
  $("#booking-list").addEventListener("click", (event) => {
    const row = event.target.closest("[data-booking-id]");
    if (!row) return;
    state.selectedId = row.dataset.bookingId;
    renderBookings();
  });
}

function setActiveBookingsTab() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.tab === "bookings")));
  document.querySelectorAll("[role='tabpanel']").forEach((panel) => { panel.hidden = panel.id !== "panel-bookings"; });
  loadBookings();
}

function renderMetrics() {
  const today = todayKey();
  const metrics = [
    ["Upcoming", state.bookings.filter((b) => b.preferredDate >= today && !isCancelled(b) && !isCompleted(b)).length],
    ["Today", state.bookings.filter((b) => b.preferredDate === today && !isCancelled(b)).length],
    ["Paid", state.bookings.filter((b) => isPaid(b) && !isCancelled(b)).length],
    ["Unpaid", state.bookings.filter((b) => !isPaid(b) && !isCancelled(b)).length],
    ["Cancelled", state.bookings.filter(isCancelled).length]
  ];
  const el = $("#booking-metrics");
  if (!el) return;
  el.innerHTML = metrics.map(([label, value]) => `<div class="booking-metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderBookings() {
  renderMetrics();
  document.querySelectorAll("[data-booking-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.bookingFilter === state.filter)));
  const list = $("#booking-list");
  const count = $("#booking-count");
  if (!list || !count) return;
  const bookings = filteredBookings().sort(bookingSort);
  count.textContent = String(bookings.length);
  list.innerHTML = "";
  if (!bookings.length) {
    list.innerHTML = '<div class="empty-blocks">No bookings match this filter.</div>';
  } else {
    bookings.forEach((booking) => {
      const pay = paymentLabel(booking);
      const stage = inspectionStatus(booking);
      const row = document.createElement("button");
      row.type = "button";
      row.className = `booking-row ${booking.id === state.selectedId ? "is-selected" : ""}`;
      row.dataset.bookingId = booking.id;
      row.innerHTML = `
        <div class="booking-row-top">
          <div><strong>${booking.customerName || "Unnamed customer"}</strong><br><span>${displayDate(booking.preferredDate)} · ${booking.preferredTimeLabel || booking.preferredTime || "No time"}</span></div>
          <small>${booking.priceDisplay || "$249"}</small>
        </div>
        <small>${booking.propertyAddress || "No address"}</small>
        <div class="booking-pill-line">
          <span class="booking-pill ${statusClass(pay)}">${pay}</span>
          <span class="booking-pill ${statusClass(stage)}">${stage}</span>
        </div>
      `;
      list.appendChild(row);
    });
  }
  renderBookingDetail();
}

function fact(label, value) {
  return `<div class="booking-fact"><span>${label}</span><strong>${value || "Not provided"}</strong></div>`;
}

function renderBookingDetail() {
  const card = $("#booking-detail-card");
  if (!card) return;
  const booking = selectedBooking();
  if (!booking) {
    card.innerHTML = '<div class="booking-detail-empty">Choose a booking to view details and actions.</div>';
    return;
  }

  card.innerHTML = `
    <div class="clean-card-heading">
      <div>
        <p class="section-kicker">Booking Details</p>
        <h2>${booking.customerName || "Booking"}</h2>
        <p class="muted-help">${booking.id}</p>
      </div>
      <span class="booking-pill ${statusClass(inspectionStatus(booking))}">${inspectionStatus(booking)}</span>
    </div>
    <div class="booking-detail-grid">
      ${fact("Payment", paymentLabel(booking))}
      ${fact("Inspection", inspectionStatus(booking))}
      ${fact("Date", displayDateLong(booking.preferredDate))}
      ${fact("Time", booking.preferredTimeLabel || booking.preferredTime)}
      ${fact("Address", booking.propertyAddress)}
      ${fact("Phone", booking.phone)}
      ${fact("Email", booking.email)}
      ${fact("Reason", booking.inspectionReason)}
      ${fact("Pool type", booking.poolType)}
      ${fact("Access", booking.accessPermissionIfNotHome ? "Access permitted if not home" : "Customer will be home")}
      ${fact("Animals", booking.animalsOnProperty ? (booking.animalsWillBeSecured ? "Animals will be secured" : "Animals noted") : "No animals noted")}
      ${fact("Notes", booking.notes || booking.accessInstructions || "No notes")}
    </div>
    <form class="booking-actions-form" id="booking-action-form">
      <div class="booking-action-row">
        <label>Move to date <input type="date" id="booking-move-date" value="${booking.preferredDate || ""}" /></label>
        <label>Move to time <select id="booking-move-slot"><option value="">Choose a date first</option></select></label>
      </div>
      <label>Admin note <textarea id="booking-admin-note" rows="3" placeholder="Optional note about the change"></textarea></label>
      <div class="booking-action-buttons">
        <button class="btn btn-primary" type="submit">Move booking</button>
        <button class="btn soft-btn" type="button" id="mark-confirmed">Mark confirmed</button>
        <button class="btn soft-btn" type="button" id="mark-completed">Mark completed</button>
        <button class="btn soft-btn" type="button" id="mark-certificate">Certificate issued</button>
        <button class="btn danger-btn" type="button" id="mark-cancelled">Cancel booking</button>
      </div>
    </form>
  `;

  $("#booking-move-date").addEventListener("change", () => loadMoveSlots(booking));
  $("#booking-action-form").addEventListener("submit", (event) => moveSelectedBooking(event, booking));
  $("#mark-confirmed").addEventListener("click", () => updateBookingStage(booking, "confirmed"));
  $("#mark-completed").addEventListener("click", () => updateBookingStage(booking, "completed"));
  $("#mark-certificate").addEventListener("click", () => updateBookingStage(booking, "certificate_issued"));
  $("#mark-cancelled").addEventListener("click", () => cancelBooking(booking));
  loadMoveSlots(booking);
}

async function loadBookings() {
  if (!auth.currentUser || normaliseEmail(auth.currentUser.email) !== ADMIN_EMAIL) return;
  setPanelMessage("Loading bookings...");
  try {
    const snap = await getDocs(collection(db, "bookings"));
    state.bookings = [];
    snap.forEach((item) => state.bookings.push({ id: item.id, ...(item.data() || {}) }));
    if (state.selectedId && !state.bookings.some((booking) => booking.id === state.selectedId)) state.selectedId = "";
    setPanelMessage(`Loaded ${state.bookings.length} booking${state.bookings.length === 1 ? "" : "s"}.`, "success");
    renderBookings();
  } catch (error) {
    console.error(error);
    setPanelMessage("Could not load bookings. Check that you are signed in as the admin email.", "error");
  }
}

function slotId(slot = {}) {
  if (slot.id) return String(slot.id);
  if (slot.start) return String(slot.start).replace(":", "_");
  return "";
}

function slotBelongsToBooking(slot = {}, id) {
  return (slot.bookingId || slot.bookedByBookingId || "") === id;
}

function slotsToMap(slots) {
  if (Array.isArray(slots)) {
    return slots.reduce((map, slot) => {
      const id = slotId(slot);
      if (id) map[id] = { ...slot, id };
      return map;
    }, {});
  }
  return slots && typeof slots === "object" ? { ...slots } : {};
}

function mapToOriginalShape(original, map) {
  if (!Array.isArray(original)) return map;
  const seen = new Set();
  const list = original.map((slot) => {
    const id = slotId(slot);
    if (!id || !map[id]) return slot;
    seen.add(id);
    return map[id];
  });
  Object.entries(map).forEach(([id, slot]) => {
    if (!seen.has(id)) list.push(slot);
  });
  return list;
}

function releaseSlot(slots, id, idToRelease) {
  const map = slotsToMap(slots);
  const slot = map[id];
  if (!slot || !slotBelongsToBooking(slot, idToRelease)) return mapToOriginalShape(slots, map);
  map[id] = {
    ...slot,
    available: true,
    booked: false,
    locked: false,
    reserved: false,
    reservationStatus: "released_by_admin",
    bookingId: null,
    bookedByBookingId: null,
    customerName: "",
    propertyAddress: "",
    paymentStatus: "released"
  };
  return mapToOriginalShape(slots, map);
}

function reserveSlot(slots, slot, booking) {
  const map = slotsToMap(slots);
  const existing = map[slot.id];
  if (!existing) throw new Error("The selected new time is no longer available.");
  if ((existing.booked || existing.locked || existing.reserved || existing.available === false) && !slotBelongsToBooking(existing, booking.id)) {
    throw new Error("The selected new time has already been booked. Choose another slot.");
  }
  map[slot.id] = {
    ...existing,
    id: slot.id,
    start: slot.start,
    end: slot.end,
    label: slot.label,
    available: false,
    booked: true,
    locked: true,
    reserved: false,
    reservationStatus: "admin_moved",
    bookingId: booking.id,
    bookedByBookingId: booking.id,
    customerName: booking.customerName || "",
    propertyAddress: booking.propertyAddress || "",
    paymentStatus: booking.paymentStatus || "paid"
  };
  return mapToOriginalShape(slots, map);
}

function availableSlotsFromDoc(data = {}, booking = null) {
  const raw = Array.isArray(data.slots) ? data.slots : Object.values(data.slots || {});
  return raw
    .map((slot) => ({ ...slot, id: slotId(slot) }))
    .filter((slot) => slot.id && (slot.available !== false && !slot.booked && !slot.locked && !slot.reserved || (booking && slotBelongsToBooking(slot, booking.id))))
    .sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start));
}

async function loadMoveSlots(booking) {
  const select = $("#booking-move-slot");
  const dateInput = $("#booking-move-date");
  if (!select || !dateInput) return;
  select.innerHTML = '<option value="">Loading...</option>';
  try {
    const targetDate = dateInput.value;
    if (!isDateKey(targetDate)) {
      select.innerHTML = '<option value="">Choose a date first</option>';
      return;
    }
    const snap = await getDoc(doc(db, "availability", targetDate));
    const data = snap.exists() ? snap.data() : {};
    const slots = availableSlotsFromDoc(data, booking);
    select.innerHTML = slots.length ? '<option value="">Choose a time</option>' : '<option value="">No available slots</option>';
    slots.forEach((slot) => {
      const clean = slot.start ? { ...makeSlotFromStart(slot.start), ...slot, id: slot.id } : slot;
      const option = document.createElement("option");
      option.value = JSON.stringify({ id: clean.id, start: clean.start, end: clean.end, label: clean.label || `${labelTime(clean.start)} - ${labelTime(clean.end)}` });
      option.textContent = `${clean.label || `${labelTime(clean.start)} - ${labelTime(clean.end)}`}${slotBelongsToBooking(slot, booking.id) ? " (current)" : ""}`;
      if (targetDate === booking.preferredDate && clean.id === booking.preferredTimeSlot) option.selected = true;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
    select.innerHTML = '<option value="">Could not load slots</option>';
  }
}

async function moveSelectedBooking(event, booking) {
  event.preventDefault();
  const date = $("#booking-move-date").value;
  const selected = $("#booking-move-slot").value;
  const adminNote = $("#booking-admin-note").value.trim();
  if (!date || !selected) return setPanelMessage("Choose the new date and time.", "error");
  const slot = JSON.parse(selected);
  if (date === booking.preferredDate && slot.id === booking.preferredTimeSlot) return setPanelMessage("That booking is already on this date and time.", "error");
  if (!window.confirm(`Move ${booking.customerName || "this booking"} to ${displayDateLong(date)} at ${slot.label}?`)) return;

  try {
    await runTransaction(db, async (transaction) => {
      const bookingRef = doc(db, "bookings", booking.id);
      const oldDate = bookingAvailabilityDate(booking);
      const oldSlot = bookingAvailabilitySlot(booking);
      const oldRef = oldDate ? doc(db, "availability", oldDate) : null;
      const newRef = doc(db, "availability", date);
      const oldSnap = oldRef ? await transaction.get(oldRef) : null;
      const newSnap = date === oldDate && oldSnap ? oldSnap : await transaction.get(newRef);
      if (!newSnap.exists()) throw new Error("The selected new date is not available.");
      const oldData = oldSnap?.exists() ? oldSnap.data() : {};
      const newData = newSnap.data() || {};
      const releasedOldSlots = releaseSlot(oldData.slots, oldSlot, booking.id);
      const reservedNewSlots = reserveSlot(date === oldDate ? releasedOldSlots : newData.slots, slot, booking);

      if (oldRef && oldSnap?.exists()) {
        transaction.set(oldRef, {
          slots: date === oldDate ? reservedNewSlots : releasedOldSlots,
          updatedAt: serverTimestamp(),
          updatedBy: ADMIN_EMAIL
        }, { merge: true });
      }
      if (date !== oldDate) {
        transaction.set(newRef, {
          slots: reservedNewSlots,
          updatedAt: serverTimestamp(),
          updatedBy: ADMIN_EMAIL
        }, { merge: true });
      }

      transaction.set(bookingRef, {
        previousPreferredDate: booking.preferredDate || null,
        previousPreferredTimeSlot: booking.preferredTimeSlot || null,
        previousPreferredTimeLabel: booking.preferredTimeLabel || booking.preferredTime || null,
        preferredDate: date,
        preferredDateDisplay: displayDateLong(date),
        preferredTimeSlot: slot.id,
        preferredTimeLabel: slot.label,
        preferredTime: slot.label,
        preferredTimeStart: slot.start,
        preferredTimeEnd: slot.end,
        availabilityLockDate: date,
        availabilityLockSlot: slot.id,
        availabilityLockStatus: "admin_moved",
        availabilityReservationStatus: "confirmed",
        status: isPaid(booking) ? "confirmed" : (booking.status || "pending_payment"),
        inspectionStatus: isPaid(booking) ? "confirmed" : (booking.inspectionStatus || "pending_payment"),
        adminLastAction: "moved",
        adminNote,
        customerNotificationType: "booking_moved",
        customerNotificationQueuedAt: serverTimestamp(),
        customerNotificationId: `${Date.now()}`,
        updatedAt: serverTimestamp(),
        updatedBy: ADMIN_EMAIL
      }, { merge: true });
    });
    setPanelMessage("Booking moved. The old slot is available, the new slot is blocked, and customer notification is queued.", "success");
    await loadBookings();
  } catch (error) {
    console.error(error);
    setPanelMessage(error.message || "Could not move booking.", "error");
  }
}

async function cancelBooking(booking) {
  const adminNote = $("#booking-admin-note")?.value?.trim() || "";
  if (!window.confirm(`Cancel booking for ${booking.customerName || "this customer"}? The slot will become available again.`)) return;
  try {
    await runTransaction(db, async (transaction) => {
      const bookingRef = doc(db, "bookings", booking.id);
      const lockDate = bookingAvailabilityDate(booking);
      const lockSlot = bookingAvailabilitySlot(booking);
      if (lockDate && lockSlot) {
        const availabilityRef = doc(db, "availability", lockDate);
        const snap = await transaction.get(availabilityRef);
        if (snap.exists()) {
          transaction.set(availabilityRef, {
            slots: releaseSlot(snap.data().slots, lockSlot, booking.id),
            updatedAt: serverTimestamp(),
            updatedBy: ADMIN_EMAIL
          }, { merge: true });
        }
      } else if (lockDate) {
        const availabilityRef = doc(db, "availability", lockDate);
        const snap = await transaction.get(availabilityRef);
        if (snap.exists()) {
          transaction.set(availabilityRef, {
            updatedAt: serverTimestamp(),
            updatedBy: ADMIN_EMAIL
          }, { merge: true });
        }
      }
      transaction.set(bookingRef, {
        status: "cancelled",
        inspectionStatus: "cancelled",
        cancelledAt: serverTimestamp(),
        availabilityLocked: false,
        availabilityLockStatus: "cancelled_by_admin",
        availabilityReservationStatus: lockDate && lockSlot ? "released" : "release_skipped_missing_slot",
        adminLastAction: "cancelled",
        adminNote,
        customerNotificationType: "booking_cancelled",
        customerNotificationQueuedAt: serverTimestamp(),
        customerNotificationId: `${Date.now()}`,
        updatedAt: serverTimestamp(),
        updatedBy: ADMIN_EMAIL
      }, { merge: true });
    });
    setPanelMessage("Booking cancelled. The slot is available again and customer notification is queued.", "success");
    await loadBookings();
  } catch (error) {
    console.error(error);
    setPanelMessage(error.message || "Could not cancel booking.", "error");
  }
}

async function updateBookingStage(booking, stage) {
  const labels = {
    confirmed: "confirmed",
    completed: "completed",
    certificate_issued: "certificate issued"
  };
  const adminNote = $("#booking-admin-note")?.value?.trim() || "";
  try {
    await runTransaction(db, async (transaction) => {
      transaction.set(doc(db, "bookings", booking.id), {
        status: stage,
        inspectionStatus: stage,
        adminLastAction: stage,
        adminNote,
        customerNotificationType: stage === "confirmed" ? "booking_confirmed" : stage,
        customerNotificationQueuedAt: stage === "completed" || stage === "certificate_issued" ? serverTimestamp() : booking.customerNotificationQueuedAt || null,
        customerNotificationId: stage === "completed" || stage === "certificate_issued" ? `${Date.now()}` : booking.customerNotificationId || null,
        updatedAt: serverTimestamp(),
        updatedBy: ADMIN_EMAIL
      }, { merge: true });
    });
    setPanelMessage(`Booking marked ${labels[stage] || stage}.`, "success");
    await loadBookings();
  } catch (error) {
    console.error(error);
    setPanelMessage("Could not update booking status.", "error");
  }
}

function initAdminBookings() {
  insertBookingsPanel();
  onAuthStateChanged(auth, (user) => {
    if (user && normaliseEmail(user.email) === ADMIN_EMAIL) {
      loadBookings();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdminBookings);
} else {
  initAdminBookings();
}
