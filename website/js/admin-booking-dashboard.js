import { app, db } from "./firebase-config.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// This module only reads Firestore. All writes, payment and slot operations
// belong to authenticated backend functions, never browser-side field edits.
const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const auth = getAuth(app);
const $ = (selector) => document.querySelector(selector);
const todayBrisbane = () => {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).reduce((map, part) => { map[part.type] = part.value; return map; }, {});
  return parts.year + "-" + parts.month + "-" + parts.day;
};
const text = (value) => value === null || value === undefined || value === "" ? "Not provided" : String(value);
let records = [];
let activeBookingId = "";
let authorized = false;
let requestSequence = 0;
const TERMINAL = new Set(["cancelled", "completed", "certificate_issued"]);

function value(id, content) {
  const node = $(id);
  if (node) node.textContent = content;
}
function bookingStatus(booking) {
  return text(booking.status || booking.inspectionStatus || booking.paymentStatus || "unknown");
}
function safeAmount(cents) {
  const n = Number(cents);
  return Number.isFinite(n) && n >= 0
    ? new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n / 100)
    : "Not provided";
}
function bookingField(record, key) {
  return record.data[key] ?? "";
}
function fieldGrid(container, fields) {
  const dl = document.createElement("dl");
  fields.forEach(([label, content]) => {
    const dt = document.createElement("dt"), dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = text(content);
    dl.append(dt, dd);
  });
  container.appendChild(dl);
}
function detailSection(container, title, fields) {
  const heading = document.createElement("h3");
  heading.textContent = title;
  if (container.childNodes.length) heading.style.marginTop = "24px";
  container.appendChild(heading);
  fieldGrid(container, fields);
}
function renderDetails() {
  const panel = $("#booking-detail");
  if (!panel) return;
  panel.replaceChildren();
  const record = records.find((item) => item.id === activeBookingId);
  if (!record) {
    panel.textContent = "Select a booking to see its details.";
    return;
  }
  const b = record.data;
  const heading = document.createElement("h3");
  heading.textContent = b.customerName || "Unnamed customer";
  panel.appendChild(heading);
  const ref = document.createElement("p");
  ref.className = "muted-help";
  ref.textContent = "Booking reference: " + record.id;
  panel.appendChild(ref);
  const actionHost = document.createElement("div");
  actionHost.id = "booking-actions-host";
  panel.appendChild(actionHost);
  detailSection(panel, "Appointment", [
    ["Status", bookingStatus(b)], ["Inspection status", b.inspectionStatus],
    ["Date", b.preferredDateDisplay || b.preferredDate], ["Time", b.preferredTimeLabel || b.preferredTime],
    ["Property", b.propertyAddress], ["Pool type", b.poolType],
    ["Reason", b.inspectionReason], ["Pool registered", b.poolRegisteredStatus],
    ["Existing certificate", b.existingCertificateStatus], ["Pool exemption", b.hasPoolExemption === true ? "Yes" : "No"],
    ["Exemption file uploaded", b.exemptionFileUploaded === true ? "Yes" : "No"]
  ]);
  detailSection(panel, "Customer & property access", [
    ["Name", b.customerName], ["Email", b.email], ["Phone", b.phone],
    ["Customer type", b.clientType || b.bookingRole], ["Property owner", b.isPropertyOwner === true ? "Yes" : "No"],
    ["Authorised to book", b.authorisedToBook === true ? "Yes" : "No"],
    ["Home at inspection", b.willBeHomeForInspection === true ? "Yes" : "No"],
    ["Access permission", b.accessPermissionIfNotHome === true ? "Yes" : "No"],
    ["Animals", b.animalsOnProperty === true ? "Yes" : "No"],
    ["Animals secured", b.animalsWillBeSecured === true ? "Yes" : "No"],
    ["Access instructions", b.accessInstructions], ["Notes", b.notes]
  ]);
  detailSection(panel, "Payment & integrations", [
    ["Payment status", b.paymentStatus], ["Payment method", b.paymentMethod],
    ["Total", safeAmount(b.stripeAmountTotal)],
    ["Refunded", safeAmount(b.stripeAmountRefunded ?? 0)],
    ["Stripe PaymentIntent", b.stripePaymentIntentId],
    ["Calendar event", b.googleCalendarEventId ? "Linked" : "Not linked"],
    ["Calendar sync", b.calendarSyncStatus || "Not recorded"],
    ["Calendar sync error", b.calendarSyncError],
    ["Customer notification", b.customerNotificationError ? "Failed: " + b.customerNotificationError :
      (b.customerNotificationId && b.customerNotificationSentId === b.customerNotificationId ? "Sent" :
        b.customerNotificationId ? "Pending" : b.customerNotificationSentType || "Not recorded")]
  ]);
  window.dispatchEvent(new CustomEvent("irongate:booking-selected", { detail: { bookingId: record.id } }));
}
function filteredBookings() {
  const search = ($("#booking-search")?.value || "").trim().toLowerCase();
  const filter = $("#booking-status-filter")?.value || "all";
  return records.filter(({ id, data }) => {
    const status = bookingStatus(data).toLowerCase(), pay = String(data.paymentStatus || "").toLowerCase();
    const matches = filter === "all" ||
      (filter === "confirmed" && (status === "confirmed" || pay === "paid" || pay === "agency_invoice") && status !== "cancelled") ||
      (filter === "pending" && (status.includes("pending") || pay.includes("checkout") || pay === "payment_processing")) ||
      (filter === "cancelled" && status === "cancelled") ||
      (filter === "completed" && (status === "completed" || status === "certificate_issued"));
    return matches && [id, data.customerName, data.email, data.propertyAddress, data.preferredDate]
      .some((part) => String(part || "").toLowerCase().includes(search));
  });
}
function renderList() {
  const panel = $("#booking-list");
  if (!panel) return;
  panel.replaceChildren();
  const matches = filteredBookings();
  value("#bookings-message", matches.length + " of " + records.length + " recent bookings shown.");
  if (!matches.length) {
    const empty = document.createElement("p"); empty.className = "empty-blocks";
    empty.textContent = "No bookings match these filters."; panel.appendChild(empty);
  }
  matches.forEach(({ id, data }) => {
    const button = document.createElement("button");
    button.type = "button"; button.className = "booking-row";
    button.setAttribute("aria-pressed", String(id === activeBookingId));
    const name = document.createElement("strong"), date = document.createElement("span"), location = document.createElement("span"), status = document.createElement("span");
    name.textContent = data.customerName || "Unnamed customer";
    date.textContent = (data.preferredDateDisplay || data.preferredDate || "Date pending") + " · " + (data.preferredTimeLabel || data.preferredTime || "Time pending");
    location.textContent = data.propertyAddress || id;
    status.textContent = bookingStatus(data) + " · " + text(data.paymentStatus);
    button.append(name, date, location, status);
    button.addEventListener("click", () => { activeBookingId = id; renderList(); renderDetails(); });
    panel.appendChild(button);
  });
}
function renderOverview() {
  const today = todayBrisbane();
  const eligible = records.filter(({ data }) => !TERMINAL.has(String(data.status || "").toLowerCase()));
  value("#ops-today", eligible.filter(({ data }) => data.preferredDate === today).length);
  value("#ops-upcoming", eligible.filter(({ data }) =>
    String(data.preferredDate || "") > today && ["paid", "agency_invoice"].includes(data.paymentStatus)).length);
  value("#ops-pending", eligible.filter(({ data }) =>
    ["pending_payment", "payment_processing"].includes(data.status) || data.paymentStatus === "checkout_created").length);
  value("#ops-cancelled", records.filter(({ data }) => data.status === "cancelled").length);
  value("#overview-message", "Showing the latest " + records.length + " bookings; totals are not all-time figures.");
  value("#payments-overview", records.filter(({ data }) => data.paymentStatus === "paid").length +
    " paid bookings in the latest " + records.length + " records. Open a booking for payment details.");
}
async function loadBookings() {
  if (!authorized) return;
  const sequence = ++requestSequence;
  value("#bookings-message", "Loading recent bookings…");
  try {
    const snapshot = await getDocs(query(collection(db, "bookings"), orderBy("createdAt", "desc"), limit(150)));
    if (!authorized || sequence !== requestSequence) return;
    records = snapshot.docs.map((item) => ({ id: item.id, data: item.data() || {} }));
    if (activeBookingId && !records.some((item) => item.id === activeBookingId)) activeBookingId = "";
    renderOverview(); renderList(); renderDetails();
  } catch (error) {
    if (!authorized || sequence !== requestSequence) return;
    console.error("Could not load admin booking list", error);
    value("#bookings-message", "Could not load bookings. Check permissions and retry.");
    value("#overview-message", "Booking summary unavailable.");
  }
}
$("#booking-search")?.addEventListener("input", renderList);
$("#booking-status-filter")?.addEventListener("change", renderList);
$("#reload-bookings")?.addEventListener("click", loadBookings);
window.addEventListener("irongate:admin-tab", (event) => {
  if (["overview", "bookings", "payments"].includes(event.detail?.tab) && authorized) loadBookings();
});
onAuthStateChanged(auth, (user) => {
  authorized = Boolean(user && user.email?.trim().toLowerCase() === ADMIN_EMAIL);
  if (!authorized) {
    ++requestSequence; records = []; activeBookingId = "";
    value("#bookings-message", "Sign in with the approved admin account.");
    $("#booking-list")?.replaceChildren();
    $("#booking-detail")?.replaceChildren();
    return;
  }
  loadBookings();
});
