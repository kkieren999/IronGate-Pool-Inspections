import { app, db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
const SERVICE_NAME = "Pool Safety Inspection & Certificate";
const PRICE_CENTS = 14900;
const PRICE_DISPLAY = "$149";
const CURRENCY = "aud";
const auth = getAuth(app);

const panel = document.querySelector("#panel-availability");

if (panel && !document.querySelector("#private-booking-card")) {
  injectPrivateBookingCard();
  initialisePrivateBookingCard();
}

function normaliseEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function brisbaneParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((map, part) => {
    map[part.type] = part.value;
    return map;
  }, {});
}

function todayBrisbaneKey() {
  const parts = brisbaneParts();
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentBrisbaneMinutes() {
  const parts = brisbaneParts();
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function parseTimeMinutes(time) {
  const [hour, minute] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function timeFromMinutes(total) {
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function defaultStartTime() {
  const now = currentBrisbaneMinutes();
  const next = Math.ceil((now + 30) / 60) * 60;
  return timeFromMinutes(Math.min(Math.max(next, 7 * 60), 18 * 60));
}

function labelTime(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function displayDate(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function comparableSlotId(slot = {}) {
  if (slot.id) return String(slot.id);
  if (slot.start) return String(slot.start).replace(":", "_");
  return "";
}

function slotsToMap(rawSlots) {
  if (Array.isArray(rawSlots)) {
    return rawSlots.reduce((map, slot) => {
      const id = comparableSlotId(slot);
      if (id) map[id] = slot;
      return map;
    }, {});
  }
  return rawSlots && typeof rawSlots === "object" ? { ...rawSlots } : {};
}

function isBusy(slot) {
  return Boolean(slot && (slot.booked === true || slot.locked === true || slot.reserved === true));
}

function originalSlotForRestore(existing) {
  if (!existing || !Object.keys(existing).length) return null;
  if (existing.privateInvite === true && Object.prototype.hasOwnProperty.call(existing, "privateInviteOriginal")) {
    return existing.privateInviteOriginal || null;
  }
  return existing;
}

function buildPrivateReservedSlot(existing, details, isBuffer = false) {
  const original = originalSlotForRestore(existing);
  return {
    ...(existing || {}),
    id: details.id,
    start: details.start,
    end: details.end,
    label: details.label,
    available: false,
    booked: true,
    locked: true,
    reserved: true,
    reservationStatus: isBuffer ? "private_invite_buffer" : "private_invite",
    bufferSlot: isBuffer,
    bufferForSlot: isBuffer ? details.selectedId : null,
    bookingId: details.bookingId,
    bookedByBookingId: details.bookingId,
    paymentStatus: "private_invite",
    privateInvite: true,
    privateInviteToken: details.token,
    privateInviteOriginal: original,
    reservedAt: Timestamp.now()
  };
}

function expiryDateForSelection(startMinutes, mode) {
  const now = new Date();
  const nowMinutes = currentBrisbaneMinutes();
  const minutesUntilSession = startMinutes - nowMinutes;
  if (minutesUntilSession <= 0) throw new Error("Choose a start time later than the current Brisbane time.");

  let requestedMinutes = minutesUntilSession;
  if (mode === "1") requestedMinutes = 60;
  if (mode === "2") requestedMinutes = 120;
  if (mode === "4") requestedMinutes = 240;

  const validForMinutes = Math.max(1, Math.min(requestedMinutes, minutesUntilSession));
  return new Date(now.getTime() + validForMinutes * 60 * 1000);
}

function setMessage(text, type = "") {
  const el = document.querySelector("#private-booking-message");
  if (!el) return;
  el.textContent = text;
  el.dataset.type = type;
}

function injectPrivateBookingCard() {
  const style = document.createElement("style");
  style.textContent = `
    .private-booking-result { margin-top: 16px; padding: 16px; border-radius: 18px; background: #eef9ff; border: 1px solid rgba(21,158,232,.22); }
    .private-booking-link-row { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; align-items: center; }
    .private-booking-link-row input { margin: 0; }
    .private-invite-list { display: grid; gap: 10px; margin-top: 14px; }
    .private-invite-item { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 13px 14px; border: 1px solid rgba(7,24,52,.08); border-radius: 16px; background: #f9fbfe; }
    .private-invite-item strong { display: block; color: var(--navy); }
    .private-invite-item span { display: block; color: var(--muted); font-size: .86rem; font-weight: 800; margin-top: 4px; }
    @media (max-width: 700px) { .private-booking-link-row { grid-template-columns: 1fr; } .private-invite-item { align-items: flex-start; flex-direction: column; } }
  `;
  document.head.appendChild(style);

  const card = document.createElement("section");
  card.className = "admin-card";
  card.id = "private-booking-card";
  card.innerHTML = `
    <div class="clean-card-heading">
      <div>
        <p class="section-kicker">Late-notice bookings</p>
        <h2>Private booking link</h2>
        <p class="muted-help">Reserve a hidden session for today and send a single-use booking link. It will not appear on the public calendar.</p>
      </div>
      <span class="summary-pill">Today only</span>
    </div>

    <div class="admin-form">
      <div class="bulk-row">
        <label>Date
          <input type="date" id="private-booking-date" readonly />
        </label>
        <label>Session start
          <input type="time" id="private-booking-time" step="3600" min="06:00" max="20:00" required />
        </label>
      </div>
      <div class="bulk-row">
        <label>Link expires
          <select id="private-booking-expiry">
            <option value="session">At session start</option>
            <option value="1">In 1 hour</option>
            <option value="2">In 2 hours</option>
            <option value="4">In 4 hours</option>
          </select>
        </label>
        <div style="display:flex;align-items:end;">
          <button class="btn btn-primary" type="button" id="generate-private-booking">Generate private link</button>
        </div>
      </div>
      <p class="muted-help">The chosen hour and the following hour are reserved so the normal booking buffer is preserved. Existing booked or reserved sessions cannot be overridden.</p>
      <p class="form-note" id="private-booking-message" role="status" aria-live="polite"></p>

      <div class="private-booking-result" id="private-booking-result" hidden>
        <strong id="private-booking-result-title">Private link ready</strong>
        <div class="private-booking-link-row" style="margin-top:10px;">
          <input type="text" id="private-booking-link" readonly aria-label="Private booking link" />
          <button class="btn soft-btn" type="button" id="copy-private-booking-link">Copy link</button>
        </div>
      </div>

      <details class="clean-details" style="margin-top:8px;">
        <summary>Recent private links</summary>
        <div class="details-inner">
          <button class="btn soft-btn" type="button" id="reload-private-bookings">Reload links</button>
          <div class="private-invite-list" id="private-invite-list"><div class="empty-blocks">No private links loaded yet.</div></div>
        </div>
      </details>
    </div>
  `;

  const workArea = panel.querySelector(".work-area");
  if (workArea) panel.insertBefore(card, workArea);
  else panel.appendChild(card);
}

function initialisePrivateBookingCard() {
  const dateInput = document.querySelector("#private-booking-date");
  const timeInput = document.querySelector("#private-booking-time");
  if (dateInput) dateInput.value = todayBrisbaneKey();
  if (timeInput) timeInput.value = defaultStartTime();

  document.querySelector("#generate-private-booking")?.addEventListener("click", generatePrivateBookingLink);
  document.querySelector("#copy-private-booking-link")?.addEventListener("click", copyPrivateBookingLink);
  document.querySelector("#reload-private-bookings")?.addEventListener("click", loadRecentPrivateInvites);
  document.querySelector("#private-invite-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-cancel-private-invite]");
    if (button) cancelPrivateInvite(button.dataset.cancelPrivateInvite);
  });

  loadRecentPrivateInvites();
}

async function generatePrivateBookingLink() {
  if (!auth.currentUser || normaliseEmail(auth.currentUser.email) !== ADMIN_EMAIL) {
    setMessage("Sign in as the IronGate admin before generating a private link.", "error");
    return;
  }

  const dateKey = document.querySelector("#private-booking-date")?.value || "";
  const start = document.querySelector("#private-booking-time")?.value || "";
  const expiryMode = document.querySelector("#private-booking-expiry")?.value || "session";
  const startMinutes = parseTimeMinutes(start);

  if (dateKey !== todayBrisbaneKey()) return setMessage("Private late-notice links can only be generated for today.", "error");
  if (startMinutes === null || startMinutes % 60 !== 0) return setMessage("Choose a full-hour start time.", "error");
  if (startMinutes < 6 * 60 || startMinutes > 20 * 60) return setMessage("Choose a session between 6:00 AM and 8:00 PM.", "error");
  if (startMinutes <= currentBrisbaneMinutes()) return setMessage("Choose a start time later than the current Brisbane time.", "error");

  const endMinutes = startMinutes + 60;
  const bufferEndMinutes = endMinutes + 60;
  const end = timeFromMinutes(endMinutes);
  const bufferEnd = timeFromMinutes(bufferEndMinutes);
  const selectedId = start.replace(":", "_");
  const bufferId = end.replace(":", "_");
  const label = `${labelTime(start)} – ${labelTime(end)}`;
  const token = randomToken();
  const bookingRef = doc(collection(db, "bookings"));
  const inviteRef = doc(db, "privateBookingInvites", token);
  const availabilityRef = doc(db, "availability", dateKey);
  const expiresAtDate = expiryDateForSelection(startMinutes, expiryMode);
  const expiresAt = Timestamp.fromDate(expiresAtDate);

  const button = document.querySelector("#generate-private-booking");
  if (button) button.disabled = true;
  setMessage("Reserving the private session…", "");

  try {
    await runTransaction(db, async (transaction) => {
      const availabilitySnap = await transaction.get(availabilityRef);
      const availability = availabilitySnap.exists() ? availabilitySnap.data() || {} : {};
      const slots = slotsToMap(availability.slots);
      const selectedExisting = slots[selectedId] || null;
      const bufferExisting = slots[bufferId] || null;

      if (isBusy(selectedExisting)) throw new Error(`${label} is already booked or reserved.`);
      if (isBusy(bufferExisting)) throw new Error(`The required buffer after ${labelTime(end)} is already booked or reserved.`);

      slots[selectedId] = buildPrivateReservedSlot(selectedExisting, {
        id: selectedId,
        start,
        end,
        label,
        selectedId,
        bookingId: bookingRef.id,
        token
      });
      slots[bufferId] = buildPrivateReservedSlot(bufferExisting, {
        id: bufferId,
        start: end,
        end: bufferEnd,
        label: `${labelTime(end)} – ${labelTime(bufferEnd)}`,
        selectedId,
        bookingId: bookingRef.id,
        token
      }, true);

      transaction.set(availabilityRef, {
        date: dateKey,
        slots,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.email
      }, { merge: true });

      transaction.set(bookingRef, {
        preferredDate: dateKey,
        preferredDateDisplay: displayDate(dateKey),
        preferredTimeSlot: selectedId,
        preferredTimeLabel: label,
        preferredTimeStart: start,
        preferredTimeEnd: end,
        preferredTime: label,
        serviceName: SERVICE_NAME,
        priceCents: PRICE_CENTS,
        priceDisplay: PRICE_DISPLAY,
        currency: CURRENCY,
        customerType: "homeowner",
        bookingRole: "Homeowner",
        status: "private_invite_pending",
        paymentStatus: "not_started",
        paymentMethod: "stripe_checkout",
        source: "private_booking_invite",
        privateInviteToken: token,
        privateInviteProof: null,
        privateInviteExpiresAt: expiresAt,
        privateInviteSubmittedAt: null,
        availabilityLocked: true,
        availabilityLockStatus: "private_invite_reserved",
        availabilityLockDate: dateKey,
        availabilityLockSlot: selectedId,
        availabilityReservationStatus: "private_invite",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        paidAt: null
      });

      transaction.set(inviteRef, {
        bookingId: bookingRef.id,
        date: dateKey,
        dateDisplay: displayDate(dateKey),
        slotId: selectedId,
        start,
        end,
        label,
        bufferSlotId: bufferId,
        status: "active",
        expiresAt,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser.email,
        source: "admin_private_booking_link"
      });
    });

    const url = new URL("/booking/", window.location.origin);
    url.searchParams.set("invite", token);
    const linkInput = document.querySelector("#private-booking-link");
    if (linkInput) linkInput.value = url.toString();
    const result = document.querySelector("#private-booking-result");
    if (result) result.hidden = false;
    const title = document.querySelector("#private-booking-result-title");
    if (title) title.textContent = `${displayDate(dateKey)}, ${label} — private link ready`;
    setMessage("Private session reserved. Send this link only to the intended customer.", "success");
    await loadRecentPrivateInvites();
  } catch (error) {
    console.error("Private booking link error:", error);
    setMessage(error.message || "Could not generate the private booking link.", "error");
  } finally {
    if (button) button.disabled = false;
  }
}

async function copyPrivateBookingLink() {
  const input = document.querySelector("#private-booking-link");
  if (!input?.value) return;
  try {
    await navigator.clipboard.writeText(input.value);
    setMessage("Private booking link copied.", "success");
  } catch {
    input.focus();
    input.select();
    document.execCommand("copy");
    setMessage("Private booking link copied.", "success");
  }
}

function inviteStatusLabel(invite) {
  if (invite.status !== "active") return invite.status || "unknown";
  const expiresAt = invite.expiresAt?.toDate?.();
  if (expiresAt && expiresAt <= new Date()) return "expired";
  return "active";
}

async function loadRecentPrivateInvites() {
  const list = document.querySelector("#private-invite-list");
  if (!list) return;
  if (!auth.currentUser || normaliseEmail(auth.currentUser.email) !== ADMIN_EMAIL) {
    list.innerHTML = '<div class="empty-blocks">Sign in to view private links.</div>';
    return;
  }

  try {
    const snap = await getDocs(query(collection(db, "privateBookingInvites"), orderBy("createdAt", "desc"), limit(10)));
    if (snap.empty) {
      list.innerHTML = '<div class="empty-blocks">No private links created yet.</div>';
      return;
    }

    list.innerHTML = "";
    snap.forEach((item) => {
      const invite = item.data() || {};
      const status = inviteStatusLabel(invite);
      const row = document.createElement("div");
      row.className = "private-invite-item";
      const canCancel = status === "active";
      row.innerHTML = `
        <div>
          <strong>${invite.dateDisplay || invite.date || "Private session"} · ${invite.label || ""}</strong>
          <span>${status.toUpperCase()} · Booking ${invite.bookingId || ""}</span>
        </div>
        ${canCancel ? `<button class="btn danger-btn" type="button" data-cancel-private-invite="${item.id}">Cancel link</button>` : ""}
      `;
      list.appendChild(row);
    });
  } catch (error) {
    console.error("Could not load private invites:", error);
    list.innerHTML = '<div class="empty-blocks">Could not load private links.</div>';
  }
}

async function cancelPrivateInvite(token) {
  if (!token || !auth.currentUser || normaliseEmail(auth.currentUser.email) !== ADMIN_EMAIL) return;
  if (!window.confirm("Cancel this private booking link and release its reserved session?")) return;

  const inviteRef = doc(db, "privateBookingInvites", token);

  try {
    await runTransaction(db, async (transaction) => {
      const inviteSnap = await transaction.get(inviteRef);
      if (!inviteSnap.exists()) throw new Error("Private link was not found.");
      const invite = inviteSnap.data() || {};
      if (invite.status !== "active") throw new Error("Only active private links can be cancelled here.");

      const bookingRef = doc(db, "bookings", invite.bookingId);
      const availabilityRef = doc(db, "availability", invite.date);
      const [bookingSnap, availabilitySnap] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(availabilityRef)
      ]);
      const booking = bookingSnap.exists() ? bookingSnap.data() || {} : {};
      if (booking.paymentStatus === "paid" || booking.status === "confirmed") throw new Error("This booking is already confirmed and cannot be cancelled from the link generator.");

      const availability = availabilitySnap.exists() ? availabilitySnap.data() || {} : {};
      const slots = slotsToMap(availability.slots);
      [invite.slotId, invite.bufferSlotId].filter(Boolean).forEach((slotId) => {
        const slot = slots[slotId];
        if (!slot || slot.privateInviteToken !== token || slot.bookingId !== invite.bookingId) return;
        if (slot.privateInviteOriginal) slots[slotId] = slot.privateInviteOriginal;
        else delete slots[slotId];
      });

      transaction.set(availabilityRef, {
        slots,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.email
      }, { merge: true });
      transaction.set(inviteRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledBy: auth.currentUser.email
      }, { merge: true });
      if (bookingSnap.exists()) {
        transaction.set(bookingRef, {
          status: "private_invite_cancelled",
          paymentStatus: "cancelled",
          availabilityLocked: false,
          availabilityLockStatus: "private_invite_cancelled",
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    });

    setMessage("Private link cancelled and the reserved session was released.", "success");
    await loadRecentPrivateInvites();
  } catch (error) {
    console.error("Could not cancel private invite:", error);
    setMessage(error.message || "Could not cancel the private booking link.", "error");
  }
}
