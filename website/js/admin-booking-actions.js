import { app, db } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, getDocs, query, collection, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");
const moveBooking = httpsCallable(functions, "adminMoveBooking");
const cancelBooking = httpsCallable(functions, "adminCancelBooking");
const $ = (selector) => document.querySelector(selector);
let selectedId = "";
let selectedBooking = null;
let authorised = false;
let selectionRequest = 0;

function keyForToday() {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).reduce((map, part) => { map[part.type] = part.value; return map; }, {});
  return parts.year + "-" + parts.month + "-" + parts.day;
}
function idFor(slot) { return String(slot?.id || (slot?.start || "").replace(":", "_")); }
function slotsFor(raw) { return Array.isArray(raw) ? raw : Object.values(raw || {}); }
function available(slot) {
  return slot?.available === true && slot.booked !== true && slot.locked !== true && slot.reserved !== true;
}
function shortDateTime(booking) {
  return (booking.preferredDateDisplay || booking.preferredDate || "No date") + ", " +
    (booking.preferredTimeLabel || booking.preferredTime || "No time");
}
function eligible(booking) {
  return booking?.status === "confirmed" &&
    ["paid", "no_payment_required", "agency_invoice"].includes(booking.paymentStatus) &&
    !["cancelled", "completed", "certificate_issued"].includes(booking.inspectionStatus);
}
function status(text, type = "") {
  const node = $("#booking-action-message");
  if (!node) return;
  node.textContent = text;
  node.dataset.type = type;
}
async function loadAvailableSlots() {
  const dropdown = $("#admin-move-slot");
  const date = $("#admin-move-date")?.value;
  if (!dropdown) return;
  dropdown.replaceChildren();
  const option = document.createElement("option");
  option.value = ""; option.textContent = "Select an available time";
  dropdown.appendChild(option);
  if (!date) return;
  try {
    const snap = await getDoc(doc(db, "availability", date));
    const slots = slotsFor(snap.exists() ? snap.data()?.slots : null);
    const byId = new Map(slots.map((slot) => [idFor(slot), slot]));
    const options = slots.filter((slot) => {
      if (!available(slot)) return false;
      const nextId = String(slot.end || "").replace(":", "_");
      const next = byId.get(nextId);
      return !next || available(next);
    }).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
    options.forEach((slot) => {
      const item = document.createElement("option");
      item.value = idFor(slot);
      item.textContent = slot.label || (slot.start + " - " + slot.end);
      dropdown.appendChild(item);
    });
    if (!options.length) status("No available inspection time plus one-hour buffer on this date.", "error");
    else status("Select a new time and confirm the change.");
  } catch (error) {
    console.error("Could not load target date", error);
    status("Could not load availability for this date.", "error");
  }
}
function renderActions() {
  const host = $("#booking-actions-host");
  if (!host) return;
  host.replaceChildren();
  if (!authorised || !selectedBooking) return;
  if (!eligible(selectedBooking)) {
    const message = document.createElement("p");
    message.className = "booking-readonly-note";
    message.textContent = "Move and cancel controls are available only for confirmed bookings. Existing completed or cancelled bookings remain viewable.";
    host.appendChild(message);
    return;
  }
  // Static markup only; booking/customer data is never inserted into HTML.
  host.innerHTML = [
    '<div class="booking-actions">',
    '<details><summary>Move this booking</summary>',
    '<form id="admin-move-form" class="admin-form">',
    '<label>New date <input id="admin-move-date" type="date" required /></label>',
    '<label>Available time <select id="admin-move-slot" required><option value="">Select date first</option></select></label>',
    '<label>Reason for change <textarea id="admin-move-reason" required minlength="8" maxlength="500" placeholder="Why is this booking moving?"></textarea></label>',
    '<label class="toggle-line"><input id="admin-move-reopen" type="checkbox" checked />Reopen the original public slot (private invitations restore their original state).</label>',
    '<button class="btn btn-primary" type="submit">Confirm move &amp; notify customer</button>',
    '</form></details>',
    '<details><summary>Cancel this booking</summary>',
    '<form id="admin-cancel-form" class="admin-form">',
    '<label>Reason for cancellation <textarea id="admin-cancel-reason" required minlength="8" maxlength="500" placeholder="Reason shown in customer email"></textarea></label>',
    '<label>Refund decision (required)<select id="admin-cancel-refund" required>',
    '<option value="">Choose explicitly</option>',
    '<option value="no_refund">Cancel without refund</option>',
    '<option value="review_refund">Cancel and review a separate full/partial refund</option>',
    '</select></label>',
    '<label class="toggle-line"><input id="admin-cancel-reopen" type="checkbox" />Reopen the original time and buffer to public bookings</label>',
    '<button class="btn danger-btn" type="submit">Confirm cancellation &amp; notify customer</button>',
    '</form></details>',
    '<p id="booking-action-message" class="form-note" role="status" aria-live="polite"></p>',
    '</div>'
  ].join("");
  $("#admin-move-date").min = keyForToday();
  $("#admin-move-date").addEventListener("change", loadAvailableSlots);
  $("#admin-move-form").addEventListener("submit", submitMove);
  $("#admin-cancel-form").addEventListener("submit", submitCancel);
}
async function sendOperation(callable, payload, button, pendingText) {
  button.disabled = true;
  status(pendingText);
  try {
    const result = await callable(payload);
    status(result.data?.alreadyApplied ? "This action was already applied. Refreshing…" :
      "Booking saved. Calendar and email updates are processed separately; check the sync status after refreshing.", "success");
    $("#reload-bookings")?.click();
    loadActivity();
  } catch (error) {
    console.error("Admin booking change failed", error);
    status(error.message || "Booking was not changed. Refresh and retry.", "error");
  } finally { button.disabled = false; }
}
async function submitMove(event) {
  event.preventDefault();
  if (!authorised || !selectedBooking || !selectedId) return;
  const date = $("#admin-move-date").value, slotId = $("#admin-move-slot").value;
  const reason = $("#admin-move-reason").value.trim();
  if (!date || !slotId || reason.length < 8) return status("Choose a date, time and reason.", "error");
  const selectedText = $("#admin-move-slot").selectedOptions[0].textContent;
  if (!window.confirm("Move " + selectedBooking.customerName + " from " + shortDateTime(selectedBooking) +
    " to " + date + " " + selectedText + "? The customer will receive a revised calendar invite.")) return;
  await sendOperation(moveBooking, {
    bookingId: selectedId, actionId: crypto.randomUUID(), date, slotId, reason,
    reopenOldSlot: $("#admin-move-reopen").checked
  }, event.submitter || $("#admin-move-form button[type=submit]"), "Reserving new slot and moving the booking…");
}
async function submitCancel(event) {
  event.preventDefault();
  if (!authorised || !selectedBooking || !selectedId) return;
  const reason = $("#admin-cancel-reason").value.trim();
  const refundDecision = $("#admin-cancel-refund").value;
  if (reason.length < 8 || !["no_refund", "review_refund"].includes(refundDecision)) {
    return status("Enter a reason and explicitly choose the refund decision.", "error");
  }
  const note = refundDecision === "review_refund"
    ? "This does NOT issue a refund; use Payments & refunds for the separate approval."
    : "No refund will be issued.";
  if (!window.confirm("Cancel " + selectedBooking.customerName + "'s booking on " +
    shortDateTime(selectedBooking) + "? A cancellation invite will be sent. " + note)) return;
  await sendOperation(cancelBooking, {
    bookingId: selectedId, actionId: crypto.randomUUID(), reason, refundDecision,
    reopenOldSlot: $("#admin-cancel-reopen").checked
  }, event.submitter || $("#admin-cancel-form button[type=submit]"), "Cancelling booking and releasing its slot…");
}
async function loadSelected() {
  if (!authorised || !selectedId) return;
  const token = ++selectionRequest;
  try {
    const snap = await getDoc(doc(db, "bookings", selectedId));
    if (!authorised || token !== selectionRequest) return;
    selectedBooking = snap.exists() ? snap.data() : null;
    renderActions();
  } catch (error) { console.error("Could not load selected booking", error); }
}
async function loadActivity() {
  if (!authorised) return;
  const panel = $("#admin-activity");
  if (!panel) return;
  panel.textContent = "Loading recent changes…";
  try {
    const snap = await getDocs(query(collection(db, "adminActivity"), orderBy("createdAt", "desc"), limit(25)));
    if (!authorised) return;
    panel.replaceChildren();
    if (snap.empty) panel.textContent = "No admin booking actions yet.";
    snap.docs.forEach((record) => {
      const activity = record.data(), row = document.createElement("p");
      row.className = "booking-activity-entry";
      row.textContent = (activity.action || "Updated") + " · " + (activity.bookingId || "") +
        " · " + (activity.reason || "No reason");
      panel.appendChild(row);
    });
  } catch (error) {
    console.error("Could not read admin activity", error);
    panel.textContent = "Could not load activity. Check Firestore rules.";
  }
}
window.addEventListener("irongate:booking-selected", (event) => {
  selectedId = event.detail?.bookingId || "";
  selectedBooking = null;
  loadSelected();
});
window.addEventListener("irongate:admin-tab", (event) => {
  if (event.detail?.tab === "systems") loadActivity();
});
onAuthStateChanged(auth, (user) => {
  authorised = Boolean(user && user.email?.toLowerCase() === ADMIN_EMAIL);
  if (!authorised) { selectedId = ""; selectedBooking = null; ++selectionRequest; }
  else loadActivity();
});
