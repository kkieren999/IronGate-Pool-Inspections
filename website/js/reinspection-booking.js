import { app, db } from "./firebase-config.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";
import { collection, documentId, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const token = window.location.hash.slice(1);
const call = httpsCallable(getFunctions(app, "us-central1"), "reinspectionBooking");
const form = document.querySelector("#reinspection-form");
const date = document.querySelector("#reinspection-date");
const time = document.querySelector("#reinspection-time");
const button = form.querySelector("button");
const message = document.querySelector("#reinspection-status");
const price = document.querySelector("#reinspection-price");
const resume = document.querySelector("#reinspection-resume");
const slotsByDate = new Map();
let currentPrice;
const dateLabel = new Intl.DateTimeFormat("en-AU", { dateStyle: "full", timeZone: "Australia/Brisbane" });

function slotId(slot) { return slot.id || slot.start?.replace(":", "_"); }
function free(slot) {
  return slot && slot.available !== false && !slot.booked && !slot.locked && !slot.reserved && !slot.bufferSlot;
}
function availableSlots(day) {
  const slots = Object.values(day.slots || {}).filter(slot => slot?.start && slot?.end);
  const byId = new Map(slots.map(slot => [slotId(slot), slot]));
  const following = slot => slot.end.replace(":", "_");
  const buffers = new Set(slots.filter(slot => slot.booked || slot.locked || slot.reserved).map(following));
  return slots.filter(slot => free(slot) && !buffers.has(slotId(slot)) &&
    (!byId.has(following(slot)) || free(byId.get(following(slot)))))
    .sort((a, b) => a.start.localeCompare(b.start));
}

async function loadSlots() {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Brisbane" }).format(new Date());
  const results = await getDocs(query(collection(db, "availability"),
    where(documentId(), ">", today), limit(120)));
  slotsByDate.clear();
  for (const day of results.docs) {
    const slots = availableSlots(day.data());
    if (slots.length) slotsByDate.set(day.id, slots);
  }
  date.replaceChildren(new Option("Choose a date", ""));
  for (const day of slotsByDate.keys()) date.add(new Option(dateLabel.format(new Date(day + "T00:00:00+10:00")), day));
  updateTimes();
  if (!slotsByDate.size) message.textContent = "No times are currently available. Check again later or call IronGate.";
  return slotsByDate.size > 0;
}

function updateTimes() {
  time.replaceChildren(new Option("Choose a time", ""));
  for (const slot of slotsByDate.get(date.value) || []) {
    time.add(new Option(slot.label || slot.start + " – " + slot.end, slotId(slot)));
  }
}

async function show(state) {
  currentPrice = state.priceCents;
  price.textContent = currentPrice === 0 ? "This reinspection is included in your booking. Amount due $0." : "Reinspection fee $89 AUD.";
  form.hidden = true;
  resume.hidden = true;
  if (["confirmed", "completed", "certificate_issued"].includes(state.status)) {
    message.textContent = "Reinspection confirmed for " + dateLabel.format(new Date(state.date + "T00:00:00+10:00")) + ", " + state.time + ".";
  } else if (state.status === "pending_payment" || state.status === "payment_processing") {
    message.textContent = "Your time is held while payment is pending. If you just paid, refresh in a moment to check confirmation.";
    if (state.checkoutUrl) {
      resume.href = state.checkoutUrl;
      resume.hidden = false;
    }
  } else if (["reinspection_invited", "payment_expired"].includes(state.status)) {
    message.textContent = "Select a date and time below.";
    button.textContent = currentPrice === 0 ? "Confirm reinspection" : "Continue to $89 secure payment";
    form.hidden = !(await loadSlots());
  } else {
    message.textContent = "This link is closed. Contact IronGate if you need help with your reinspection.";
  }
}

date.addEventListener("change", updateTimes);
form.addEventListener("submit", async event => {
  event.preventDefault();
  button.disabled = true;
  try {
    const { data } = await call({ action: "book", token, date: date.value, slotId: time.value, expectedPriceCents: currentPrice });
    if (data.checkoutUrl) window.location.assign(data.checkoutUrl);
    else await show(data);
  } catch (error) {
    message.textContent = error.message || "Could not book this time. Please try again.";
    await loadSlots().catch(() => {});
  } finally {
    button.disabled = false;
  }
});

try {
  if (!/^[a-f0-9]{48}\.[a-f0-9]{48}$/.test(token)) throw new Error("Open the private link from your IronGate email.");
  const { data } = await call({ action: "status", token });
  await show(data);
} catch (error) {
  message.textContent = error.message || "Could not open this reinspection link.";
}

