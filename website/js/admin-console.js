import "./admin-private-booking.js";
import "./admin-booking-dashboard.js?v=20261007background1";
import "./admin-booking-actions.js";
import "./admin-refund-panel.js";
import { app, db } from "./firebase-config.js";
    import { collection, deleteDoc, doc, documentId, getDoc, getDocs, query, serverTimestamp, setDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
    import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

    const ADMIN_EMAIL = "irongate.pool.bne@gmail.com";
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const auth = getAuth(app);
    let currentDate = "";
    let blocks = [];
    let calendarMonth = startOfMonth(new Date());
    let monthAvailability = new Map();
    let anchorDate = "";
    let selectedDates = new Set();
    let currentPartnerCode = "";
    let agencyPartners = new Map();

    const $ = (id) => document.querySelector(id);
    const loginCard = $("#login-card");
    const consolePanel = $("#console");
    const statusPill = $("#status-pill");
    const signout = $("#signout");
    const dateInput = $("#selected-date");
    const startInput = $("#slot-start");
    const blockList = $("#block-list");
    const blockCount = $("#block-count");
    const dayMessage = $("#day-message");
    const bulkMessage = $("#bulk-message");
    const partnerMessage = $("#partner-message");
    const calendarEl = $("#admin-calendar");
    const monthTitle = $("#month-title");
    const selectedHeading = $("#selected-heading");
    const selectedRangeTitle = $("#selected-range-title");
    const selectedRangeHelp = $("#selected-range-help");
    const editorKicker = $("#editor-kicker");
    const editorHelp = $("#editor-help");
    const editorModePill = $("#editor-mode-pill");
    const saveDayButton = $("#save-day");
    const deleteDayButton = $("#delete-day");

    function msg(el, text, type = "") {
      if (!el) return;
      el.textContent = text;
      el.dataset.type = type;
    }

    function normaliseEmail(email) {
      return String(email || "").trim().toLowerCase();
    }

    function startOfMonth(date) {
      return new Date(date.getFullYear(), date.getMonth(), 1);
    }

    function getMonthEnd(date) {
      return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }

    function toDateKey(date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }

    function parseDateKey(key) {
      const [y, m, d] = String(key || "").split("-").map(Number);
      return new Date(y, m - 1, d);
    }

    function isPastDate(date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const compare = new Date(date);
      compare.setHours(0, 0, 0, 0);
      return compare < today;
    }

    function displayDate(key) {
      if (!key) return "No date selected";
      return parseDateKey(key).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    }

    function displayShortDate(key) {
      if (!key) return "";
      return parseDateKey(key).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
    }

    function minutesFromTime(time) {
      const [h, m] = String(time || "").split(":").map(Number);
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
      return h * 60 + m;
    }

    function timeFromMinutes(total) {
      const h = Math.floor(total / 60);
      const m = total % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    function labelTime(time) {
      const [h, m] = time.split(":").map(Number);
      const suffix = h >= 12 ? "PM" : "AM";
      const hour = h % 12 || 12;
      return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
    }

    function makeBlock(startTime) {
      const startMinutes = minutesFromTime(startTime);
      if (startMinutes === null) throw new Error("Choose a valid start time.");
      if (startMinutes % 60 !== 0) throw new Error("Use full-hour times only, for example 08:00 or 14:00.");
      const endMinutes = startMinutes + 60;
      if (endMinutes > 24 * 60) throw new Error("The 1-hour time cannot finish after midnight.");
      const start = timeFromMinutes(startMinutes);
      const end = timeFromMinutes(endMinutes);
      return { id: start.replace(":", "_"), start, end, label: `${labelTime(start)} – ${labelTime(end)}`, available: true, booked: false };
    }

    function sortBlocks(list) {
      return [...list].sort((a, b) => minutesFromTime(a.start) - minutesFromTime(b.start));
    }

    function isLockedSlot(slot) {
      return slot?.booked === true || Boolean(slot?.bookingId) || Boolean(slot?.lockedAt);
    }

    function slotId(slot) {
      if (slot?.id) return String(slot.id);
      if (slot?.start) return String(slot.start).replace(":", "_");
      return "";
    }

    function normaliseBlocks(data) {
      const raw = Array.isArray(data?.slots) ? data.slots : Object.values(data?.slots || {});
      return sortBlocks(raw.map((slot) => {
        if (!slot?.start || isLockedSlot(slot) || slot.available === false) return null;
        try {
          const clean = makeBlock(slot.start);
          return { ...clean, booked: false, available: true };
        } catch {
          return null;
        }
      }).filter(Boolean));
    }

    function getLockedSlots(data) {
      const raw = Array.isArray(data?.slots) ? data.slots : Object.values(data?.slots || {});
      return raw.reduce((map, slot) => {
        if (!isLockedSlot(slot)) return map;
        const id = slotId(slot);
        if (id) map[id] = { ...slot, id, available: false, booked: true };
        return map;
      }, {});
    }

    function blocksToMap(list) {
      return sortBlocks(list).reduce((map, block) => {
        map[block.id] = block;
        return map;
      }, {});
    }

    async function buildAvailabilityPayload(key, blockList) {
      const snap = await getDoc(doc(db, "availability", key));
      const existing = snap.exists() ? snap.data() : {};
      const lockedSlots = getLockedSlots(existing);
      const availableSlots = blocksToMap(blockList);
      const slotMap = { ...availableSlots, ...lockedSlots };
      const lockedCount = Object.keys(lockedSlots).length;
      const availableCount = Object.keys(availableSlots).length;
      return {
        date: key,
        status: availableCount ? "available" : "unavailable",
        available: availableCount > 0,
        availableCount,
        availableSlotCount: availableCount,
        lockedSlotCount: lockedCount,
        slots: slotMap,
        note: $("#day-note").value.trim(),
        reason: $("#day-reason").value.trim() || (availableCount ? "" : "No available times"),
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || ADMIN_EMAIL
      };
    }

    function buildDateRange(startKey, endKey) {
      const start = parseDateKey(startKey);
      const end = parseDateKey(endKey);
      if (end < start) throw new Error("End date must be after start date.");
      const dates = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        dates.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
      }
      return dates;
    }

    function getDateKeysBetween(a, b) {
      const start = parseDateKey(a);
      const end = parseDateKey(b);
      const first = start <= end ? a : b;
      const last = start <= end ? b : a;
      return buildDateRange(first, last).map(toDateKey);
    }

    function isMultiSelect() {
      return selectedDates.size > 1;
    }

    function selectedDateList() {
      return [...selectedDates].sort();
    }

    function selectedRangeLabel() {
      const dates = selectedDateList();
      if (!dates.length) return "No date selected";
      if (dates.length === 1) return displayDate(dates[0]);
      const contiguous = dates.every((key, index) => {
        if (index === 0) return true;
        const next = parseDateKey(dates[index - 1]);
        next.setDate(next.getDate() + 1);
        return toDateKey(next) === key;
      });
      if (contiguous) return `${displayShortDate(dates[0])} – ${displayShortDate(dates[dates.length - 1])}`;
      if (dates.length <= 4) return dates.map(displayShortDate).join(", ");
      return `${dates.slice(0, 3).map(displayShortDate).join(", ")} + ${dates.length - 3} more`;
    }

    function updateEditorLabels() {
      const count = selectedDates.size || (currentDate ? 1 : 0);
      const multi = count > 1;
      if (selectedRangeTitle) selectedRangeTitle.textContent = `${count} day${count === 1 ? "" : "s"} selected`;
      if (selectedRangeHelp) selectedRangeHelp.textContent = multi ? "The editor below applies to every selected purple date. Ctrl/Cmd-click to add or remove individual days." : "Shift-click for a range, or Ctrl/Cmd-click to pick individual days.";
      if (editorKicker) editorKicker.textContent = multi ? "Selected Dates" : "Selected Date";
      if (editorModePill) {
        editorModePill.textContent = multi ? "Multi-day edit" : "Single-day edit";
        editorModePill.dataset.mode = multi ? "multi" : "single";
      }
      if (selectedHeading) selectedHeading.textContent = selectedRangeLabel();
      if (editorHelp) editorHelp.textContent = multi ? `Add times once, then apply them to all ${count} selected dates.` : "Add the 1-hour times you are available for this date.";
      if (saveDayButton) saveDayButton.textContent = multi ? `Apply to ${count} selected dates` : "Save this date";
      if (deleteDayButton) deleteDayButton.textContent = multi ? "Delete editing date" : "Delete date";
    }

    function renderBlocks() {
      blocks = sortBlocks(blocks);
      blockCount.textContent = String(blocks.length);
      blockList.innerHTML = "";
      updateEditorLabels();
      if (!blocks.length) {
        blockList.innerHTML = '<div class="empty-blocks">No available times added yet.</div>';
        return;
      }
      blocks.forEach((block) => {
        const row = document.createElement("div");
        row.className = "block-item";
        row.innerHTML = `<div><strong>${block.label}</strong><span>${block.start} to ${block.end}</span></div><button type="button" class="remove-block">Remove</button>`;
        row.querySelector("button").addEventListener("click", () => {
          blocks = blocks.filter((item) => item.id !== block.id);
          renderBlocks();
          msg(dayMessage, isMultiSelect() ? "Time removed from the multi-day editor. Click Apply when finished." : "Time removed. Click Save this date when finished.", "success");
        });
        blockList.appendChild(row);
      });
    }

    function getSavedBlockCount(dateKey) {
      return normaliseBlocks(monthAvailability.get(dateKey)).length;
    }

    function renderCalendar() {
      if (!calendarEl || !monthTitle) return;
      const year = calendarMonth.getFullYear();
      const month = calendarMonth.getMonth();
      const firstWeekday = calendarMonth.getDay();
      const daysInMonth = getMonthEnd(calendarMonth).getDate();
      monthTitle.textContent = `${monthNames[month]} ${year}`;
      calendarEl.innerHTML = "";

      for (let i = 0; i < firstWeekday; i += 1) {
        const empty = document.createElement("span");
        empty.className = "calendar-empty";
        calendarEl.appendChild(empty);
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const date = new Date(year, month, day);
        const key = toDateKey(date);
        const count = getSavedBlockCount(key);
        const button = document.createElement("button");
        button.type = "button";
        button.className = `calendar-day ${count ? "has-blocks" : "no-blocks"}`;
        if (isPastDate(date)) button.classList.add("is-past");
        if (key === currentDate) button.classList.add("is-editing");
        if (selectedDates.has(key) && key !== currentDate) button.classList.add("is-range");
        button.innerHTML = `<span class="day-number">${day}</span><span class="day-status">${count ? `${count} time${count === 1 ? "" : "s"}` : "No times"}</span>`;
        button.addEventListener("click", (event) => handleCalendarDateClick(key, event.shiftKey, event.ctrlKey || event.metaKey));
        calendarEl.appendChild(button);
      }
      updateEditorLabels();
    }

    async function handleCalendarDateClick(key, isShiftClick, isToggleClick) {
      if (isToggleClick) {
        if (!selectedDates.size) {
          anchorDate = key;
          selectedDates = new Set([key]);
          currentDate = key;
          dateInput.value = key;
          await loadSingleDate(key);
          return;
        }

        const nextSelected = new Set(selectedDates);
        if (nextSelected.has(key)) {
          if (nextSelected.size === 1) {
            msg(dayMessage, "Keep at least one date selected. Click another date to switch days.", "error");
            return;
          }
          nextSelected.delete(key);
          selectedDates = nextSelected;
          if (currentDate === key) {
            const remaining = selectedDateList();
            currentDate = remaining[remaining.length - 1] || "";
            dateInput.value = currentDate;
          }
          if (anchorDate === key) anchorDate = currentDate;
          msg(dayMessage, `${selectedDates.size} dates selected. The times below will apply to all selected dates.`, "success");
          renderCalendar();
          renderBlocks();
          return;
        }

        nextSelected.add(key);
        selectedDates = nextSelected;
        currentDate = key;
        anchorDate = key;
        dateInput.value = key;
        msg(dayMessage, `${selectedDates.size} dates selected. The times below will apply to all selected dates.`, "success");
        renderCalendar();
        renderBlocks();
        return;
      }

      if (isShiftClick && anchorDate) {
        selectedDates = new Set(getDateKeysBetween(anchorDate, key));
        currentDate = key;
        dateInput.value = key;
        msg(dayMessage, `${selectedDates.size} dates selected. The times below will apply to all selected dates.`, "success");
        renderCalendar();
        renderBlocks();
        return;
      }
      anchorDate = key;
      selectedDates = new Set([key]);
      currentDate = key;
      dateInput.value = key;
      await loadSingleDate(key);
    }

    async function loadMonthAvailability() {
      monthAvailability = new Map();
      renderCalendar();
      try {
        const first = toDateKey(calendarMonth);
        const last = toDateKey(getMonthEnd(calendarMonth));
        const q = query(collection(db, "availability"), where(documentId(), ">=", first), where(documentId(), "<=", last));
        const snap = await getDocs(q);
        snap.forEach((item) => monthAvailability.set(item.id, item.data()));
      } catch (error) {
        console.error(error);
        msg(dayMessage, "Could not load calendar availability from Firestore.", "error");
      }
      renderCalendar();
    }

    function addBlock(time) {
      if (!currentDate) {
        msg(dayMessage, "Choose a date first.", "error");
        dateInput.focus();
        return;
      }
      try {
        const block = makeBlock(time);
        if (blocks.some((item) => item.id === block.id)) {
          msg(dayMessage, `${block.label} is already added.`, "error");
          return;
        }
        blocks.push(block);
        renderBlocks();
        msg(dayMessage, isMultiSelect() ? `${block.label} added to the multi-day editor. Click Apply when finished.` : `${block.label} added. Click Save this date when finished.`, "success");
      } catch (error) {
        msg(dayMessage, error.message || "Could not add time.", "error");
      }
    }

    async function loadSingleDate(dateKey) {
      currentDate = dateKey;
      blocks = [];
      msg(dayMessage, "");
      selectedDates = dateKey ? new Set([dateKey]) : new Set();
      anchorDate = dateKey;
      renderCalendar();
      if (!dateKey) {
        renderBlocks();
        return;
      }
      try {
        const snap = await getDoc(doc(db, "availability", dateKey));
        if (snap.exists()) {
          const data = snap.data();
          blocks = normaliseBlocks(data);
          $("#day-note").value = data.note || "";
          $("#day-reason").value = data.reason || "";
          const lockedCount = Object.keys(getLockedSlots(data)).length;
          const lockedMessage = lockedCount ? ` ${lockedCount} booked/locked slot${lockedCount === 1 ? " is" : "s are"} preserved.` : "";
          msg(dayMessage, `Loaded ${blocks.length} editable time${blocks.length === 1 ? "" : "s"} for ${displayDate(dateKey)}.${lockedMessage}`, "success");
        } else {
          $("#day-note").value = "";
          $("#day-reason").value = "";
          msg(dayMessage, `No saved times for ${displayDate(dateKey)} yet. Add times below.`, "");
        }
      } catch (error) {
        console.error(error);
        msg(dayMessage, "Could not load that date from Firestore.", "error");
      }
      renderBlocks();
      renderCalendar();
    }

    async function saveCurrentSelection(event) {
      if (event) event.preventDefault();
      if (!currentDate) return msg(dayMessage, "Choose a date first.", "error");
      const targets = selectedDateList().length ? selectedDateList() : [currentDate];
      const multi = targets.length > 1;
      if (multi) {
        const confirmed = window.confirm(`Apply the current ${blocks.length} time(s) to ${targets.length} selected date(s)? This replaces editable availability on those dates but preserves booked slots.`);
        if (!confirmed) return;
      }
      try {
        const batch = writeBatch(db);
        const payloads = await Promise.all(targets.map(async (key) => [key, await buildAvailabilityPayload(key, blocks)]));
        payloads.forEach(([key, payload]) => batch.set(doc(db, "availability", key), payload, { merge: true }));
        await batch.commit();
        payloads.forEach(([key, payload]) => monthAvailability.set(key, payload));
        renderCalendar();
        msg(dayMessage, multi ? `Applied ${blocks.length} editable time(s) to ${targets.length} selected date(s). Booked slots were preserved.` : `${displayDate(currentDate)} saved with ${blocks.length} editable time${blocks.length === 1 ? "" : "s"}.`, "success");
      } catch (error) {
        console.error(error);
        msg(dayMessage, "Could not save. Check Firestore rules and that you are signed in as admin.", "error");
      }
    }

    async function deleteDate() {
      if (!currentDate) return msg(dayMessage, "Choose a date first.", "error");
      if (!window.confirm(`Delete editable availability for ${displayDate(currentDate)}? Booked slots will be preserved.`)) return;
      try {
        const ref = doc(db, "availability", currentDate);
        const snap = await getDoc(ref);
        const lockedSlots = getLockedSlots(snap.exists() ? snap.data() : {});
        if (Object.keys(lockedSlots).length) {
          const payload = {
            date: currentDate,
            status: "unavailable",
            available: false,
            availableCount: 0,
            availableSlotCount: 0,
            lockedSlotCount: Object.keys(lockedSlots).length,
            slots: lockedSlots,
            reason: "No available times",
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.email || ADMIN_EMAIL
          };
          await setDoc(ref, payload, { merge: false });
          monthAvailability.set(currentDate, payload);
        } else {
          await deleteDoc(ref);
          monthAvailability.delete(currentDate);
        }
        blocks = [];
        $("#day-note").value = "";
        $("#day-reason").value = "";
        renderBlocks();
        renderCalendar();
        msg(dayMessage, `${displayDate(currentDate)} editable availability deleted.`, "success");
      } catch (error) {
        console.error(error);
        msg(dayMessage, "Could not delete that date.", "error");
      }
    }

    function buildBlocksBetween(startTime, endTime) {
      const start = minutesFromTime(startTime);
      const end = minutesFromTime(endTime);
      if (start === null || end === null) throw new Error("Choose valid start and finish times.");
      if (end <= start) throw new Error("Finish time must be later than start time.");
      if ((end - start) % 60 !== 0) throw new Error("Use full 1-hour times only, for example 08:00 to 14:00.");
      const list = [];
      for (let minute = start; minute < end; minute += 60) list.push(makeBlock(timeFromMinutes(minute)));
      return list;
    }

    function selectedBulkDays() {
      return [...document.querySelectorAll(".bulk-day:checked")].map((input) => Number(input.value));
    }

    async function saveBulk(event) {
      event.preventDefault();
      msg(bulkMessage, "");
      try {
        const startKey = $("#bulk-start").value;
        const endKey = $("#bulk-end").value;
        const selectedDays = selectedBulkDays();
        const newBlocks = buildBlocksBetween($("#bulk-start-time").value, $("#bulk-end-time").value);
        if (!startKey || !endKey) throw new Error("Choose a date range.");
        if (!selectedDays.length) throw new Error("Choose at least one weekday.");
        const dates = buildDateRange(startKey, endKey).filter((date) => selectedDays.includes(date.getDay()));
        if (!dates.length) throw new Error("No dates matched your selected days.");
        if (!window.confirm(`Create ${newBlocks.length} time(s) on ${dates.length} date(s)? This replaces editable availability but preserves booked slots.`)) return;
        const batch = writeBatch(db);
        for (const date of dates) {
          const key = toDateKey(date);
          const snap = await getDoc(doc(db, "availability", key));
          const lockedSlots = getLockedSlots(snap.exists() ? snap.data() : {});
          const availableSlots = blocksToMap(newBlocks);
          batch.set(doc(db, "availability", key), {
            date: key,
            status: "available",
            available: true,
            availableCount: newBlocks.length,
            availableSlotCount: newBlocks.length,
            lockedSlotCount: Object.keys(lockedSlots).length,
            slots: { ...availableSlots, ...lockedSlots },
            note: $("#bulk-note").value.trim(),
            reason: "",
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser?.email || ADMIN_EMAIL
          }, { merge: true });
        }
        await batch.commit();
        msg(bulkMessage, `Created ${newBlocks.length} editable time(s) on ${dates.length} date(s). Booked slots were preserved.`, "success");
        await loadMonthAvailability();
        if (currentDate && selectedDates.size === 1) loadSingleDate(currentDate);
      } catch (error) {
        console.error(error);
        msg(bulkMessage, error.message || "Could not create range.", "error");
      }
    }

    async function deleteBulk() {
      msg(bulkMessage, "");
      try {
        const startKey = $("#bulk-start").value;
        const endKey = $("#bulk-end").value;
        const selectedDays = selectedBulkDays();
        if (!startKey || !endKey) throw new Error("Choose a date range.");
        if (!selectedDays.length) throw new Error("Choose at least one weekday.");
        const dates = buildDateRange(startKey, endKey).filter((date) => selectedDays.includes(date.getDay()));
        if (!window.confirm(`Delete editable availability on ${dates.length} date(s)? Booked slots will be preserved.`)) return;
        const batch = writeBatch(db);
        for (const date of dates) {
          const key = toDateKey(date);
          const ref = doc(db, "availability", key);
          const snap = await getDoc(ref);
          const lockedSlots = getLockedSlots(snap.exists() ? snap.data() : {});
          if (Object.keys(lockedSlots).length) {
            batch.set(ref, {
              date: key,
              status: "unavailable",
              available: false,
              availableCount: 0,
              availableSlotCount: 0,
              lockedSlotCount: Object.keys(lockedSlots).length,
              slots: lockedSlots,
              reason: "No available times",
              updatedAt: serverTimestamp(),
              updatedBy: auth.currentUser?.email || ADMIN_EMAIL
            }, { merge: false });
          } else {
            batch.delete(ref);
          }
        }
        await batch.commit();
        msg(bulkMessage, `Deleted editable availability on ${dates.length} date(s). Booked slots were preserved.`, "success");
        await loadMonthAvailability();
        if (currentDate && selectedDates.size === 1) loadSingleDate(currentDate);
      } catch (error) {
        console.error(error);
        msg(bulkMessage, error.message || "Could not delete range.", "error");
      }
    }

    function setActiveTab(tabName) {
      document.querySelectorAll("[data-tab]").forEach((button) => {
        const active = button.dataset.tab === tabName;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      document.querySelectorAll("[role='tabpanel']").forEach((panel) => { panel.hidden = panel.id !== `panel-${tabName}`; });
      if (tabName === "partners") loadAgencyPartners();
      window.dispatchEvent(new CustomEvent("irongate:admin-tab", { detail: { tab: tabName } }));
    }

    function normalisePartnerCode(value) {
      return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
    }

    function partnerValue(id) {
      return $(id)?.value?.trim() || "";
    }

    function resetPartnerForm() {
      currentPartnerCode = "";
      $("#partner-code").disabled = false;
      $("#partner-code").value = "";
      $("#partner-status").value = "active";
      $("#partner-agency-name").value = "";
      $("#partner-contact-name").value = "";
      $("#partner-contact-email").value = "";
      $("#partner-contact-phone").value = "";
      $("#partner-discount-code").value = "";
      $("#partner-invoice-terms").value = "7 days";
      $("#partner-invoice-enabled").checked = true;
      $("#partner-notes").value = "";
      msg(partnerMessage, "Ready to create a new agency partner.", "success");
    }

    async function loadAgencyPartners() {
      if (!auth.currentUser || normaliseEmail(auth.currentUser.email) !== ADMIN_EMAIL) return;
      try {
        agencyPartners = new Map();
        const snap = await getDocs(collection(db, "agencyPartners"));
        snap.forEach((item) => agencyPartners.set(item.id, item.data() || {}));
        renderAgencyPartners();
      } catch (error) {
        console.error(error);
        msg(partnerMessage, "Could not load agency partners. Check Firestore rules for agencyPartners.", "error");
      }
    }

    function renderAgencyPartners() {
      const list = $("#partner-list");
      const count = $("#partner-count");
      if (!list || !count) return;
      const entries = [...agencyPartners.entries()].sort(([a], [b]) => a.localeCompare(b));
      count.textContent = String(entries.length);
      list.innerHTML = "";
      if (!entries.length) {
        list.innerHTML = '<div class="empty-blocks">No agency partners created yet.</div>';
        return;
      }
      entries.forEach(([code, data]) => {
        const active = data.status === "active";
        const invoiceEnabled = data.invoiceAccountEnabled === true;
        const row = document.createElement("div");
        row.className = "partner-item";
        row.innerHTML = `
          <div>
            <strong>${data.agencyName || code}</strong>
            <span>${code}${data.discountCode ? ` · Stripe promo: ${data.discountCode}` : ""}</span>
            <div class="partner-meta">
              <span class="meta-pill ${active ? "is-active" : "is-inactive"}">${active ? "Active" : "Inactive"}</span>
              <span class="meta-pill ${invoiceEnabled ? "is-active" : "is-inactive"}">${invoiceEnabled ? "Invoice enabled" : "Invoice disabled"}</span>
              <span class="meta-pill">Terms: ${data.invoiceTerms || "7 days"}</span>
            </div>
          </div>
          <div class="actions">
            <button class="btn soft-btn" type="button" data-edit-partner="${code}">Edit</button>
            <button class="btn danger-btn" type="button" data-deactivate-partner="${code}">Deactivate</button>
          </div>
        `;
        list.appendChild(row);
      });
    }

    function fillPartnerForm(code) {
      const data = agencyPartners.get(code);
      if (!data) return;
      currentPartnerCode = code;
      $("#partner-code").value = code;
      $("#partner-code").disabled = true;
      $("#partner-status").value = data.status || "active";
      $("#partner-agency-name").value = data.agencyName || "";
      $("#partner-contact-name").value = data.primaryContactName || "";
      $("#partner-contact-email").value = data.primaryEmail || "";
      $("#partner-contact-phone").value = data.primaryPhone || "";
      $("#partner-discount-code").value = data.discountCode || "";
      $("#partner-invoice-terms").value = data.invoiceTerms || "7 days";
      $("#partner-invoice-enabled").checked = data.invoiceAccountEnabled === true;
      $("#partner-notes").value = data.notes || "";
      msg(partnerMessage, `Editing ${code}.`, "success");
    }

    async function savePartner(event) {
      event.preventDefault();
      msg(partnerMessage, "");
      const code = currentPartnerCode || normalisePartnerCode(partnerValue("#partner-code"));
      if (!code) return msg(partnerMessage, "Enter a partner code such as BIGHOUSE.", "error");
      const agencyName = partnerValue("#partner-agency-name");
      if (!agencyName) return msg(partnerMessage, "Enter the agency name.", "error");

      try {
        const ref = doc(db, "agencyPartners", code);
        const existing = await getDoc(ref);
        const payload = {
          agencyName,
          status: partnerValue("#partner-status") || "active",
          invoiceAccountEnabled: $("#partner-invoice-enabled").checked === true,
          invoiceTerms: partnerValue("#partner-invoice-terms") || "7 days",
          discountCode: normalisePartnerCode(partnerValue("#partner-discount-code")),
          primaryContactName: partnerValue("#partner-contact-name"),
          primaryEmail: partnerValue("#partner-contact-email"),
          primaryPhone: partnerValue("#partner-contact-phone"),
          notes: partnerValue("#partner-notes"),
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.email || ADMIN_EMAIL
        };
        if (!existing.exists()) payload.createdAt = serverTimestamp();
        await setDoc(ref, payload, { merge: true });
        currentPartnerCode = code;
        $("#partner-code").disabled = true;
        msg(partnerMessage, `${agencyName} saved. Partner code: ${code}`, "success");
        await loadAgencyPartners();
      } catch (error) {
        console.error(error);
        msg(partnerMessage, "Could not save agency partner. Check Firestore rules for agencyPartners.", "error");
      }
    }

    async function deactivatePartner(code = currentPartnerCode) {
      const partnerCode = normalisePartnerCode(code || $("#partner-code").value);
      if (!partnerCode) return msg(partnerMessage, "Choose a partner first.", "error");
      if (!window.confirm(`Deactivate ${partnerCode}? Invoice bookings using this code will stop working.`)) return;
      try {
        await setDoc(doc(db, "agencyPartners", partnerCode), {
          status: "inactive",
          invoiceAccountEnabled: false,
          updatedAt: serverTimestamp(),
          updatedBy: auth.currentUser?.email || ADMIN_EMAIL
        }, { merge: true });
        msg(partnerMessage, `${partnerCode} deactivated.`, "success");
        await loadAgencyPartners();
        if (currentPartnerCode === partnerCode) fillPartnerForm(partnerCode);
      } catch (error) {
        console.error(error);
        msg(partnerMessage, "Could not deactivate agency partner.", "error");
      }
    }

    $("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      msg($("#login-message"), "");
      const email = $("#email").value;
      const password = $("#password").value;
      if (normaliseEmail(email) !== ADMIN_EMAIL) return msg($("#login-message"), `Use ${ADMIN_EMAIL}`, "error");
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        console.error(error);
        msg($("#login-message"), `Sign in failed. Firebase code: ${error.code || "unknown"}`, "error");
      }
    });

    document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => setActiveTab(button.dataset.tab)));
    const tabButtons = [...document.querySelectorAll(".console-tab[data-tab]")];
    tabButtons.forEach((button, index) => button.addEventListener("keydown", (event) => {
      let target = index;
      if (event.key === "ArrowRight") target = (index + 1) % tabButtons.length;
      else if (event.key === "ArrowLeft") target = (index - 1 + tabButtons.length) % tabButtons.length;
      else if (event.key === "Home") target = 0;
      else if (event.key === "End") target = tabButtons.length - 1;
      else return;
      event.preventDefault();
      setActiveTab(tabButtons[target].dataset.tab);
      tabButtons[target].focus();
    }));
    dateInput.addEventListener("change", () => {
      if (dateInput.value) calendarMonth = startOfMonth(parseDateKey(dateInput.value));
      loadMonthAvailability();
      loadSingleDate(dateInput.value);
    });
    $("#add-block").addEventListener("click", () => addBlock(startInput.value));
    $("#clear-blocks").addEventListener("click", () => { blocks = []; renderBlocks(); msg(dayMessage, isMultiSelect() ? "Times cleared from the multi-day editor. Click Apply when finished." : "Times cleared. Click Save this date when finished.", "success"); });
    $("#delete-day").addEventListener("click", deleteDate);
    $("#day-form").addEventListener("submit", saveCurrentSelection);
    $("#clear-selected-days").addEventListener("click", () => {
      selectedDates = currentDate ? new Set([currentDate]) : new Set();
      anchorDate = currentDate;
      renderCalendar();
      renderBlocks();
      msg(dayMessage, "Back to single-day editing.", "success");
    });
    $("#bulk-form").addEventListener("submit", saveBulk);
    $("#bulk-delete").addEventListener("click", deleteBulk);
    $("#quick-times").addEventListener("click", (event) => {
      const button = event.target.closest("[data-time]");
      if (!button) return;
      startInput.value = button.dataset.time;
      addBlock(button.dataset.time);
    });
    $("#prev-month").addEventListener("click", () => {
      calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
      loadMonthAvailability();
    });
    $("#next-month").addEventListener("click", () => {
      calendarMonth = startOfMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
      loadMonthAvailability();
    });
    $("#partner-form").addEventListener("submit", savePartner);
    $("#reset-partner").addEventListener("click", resetPartnerForm);
    $("#deactivate-partner").addEventListener("click", () => deactivatePartner());
    $("#reload-partners").addEventListener("click", loadAgencyPartners);
    $("#partner-code").addEventListener("input", () => { $("#partner-code").value = normalisePartnerCode($("#partner-code").value); });
    $("#partner-discount-code").addEventListener("input", () => { $("#partner-discount-code").value = normalisePartnerCode($("#partner-discount-code").value); });
    $("#partner-list").addEventListener("click", (event) => {
      const edit = event.target.closest("[data-edit-partner]");
      const deactivate = event.target.closest("[data-deactivate-partner]");
      if (edit) fillPartnerForm(edit.dataset.editPartner);
      if (deactivate) deactivatePartner(deactivate.dataset.deactivatePartner);
    });
    signout.addEventListener("click", () => signOut(auth));

    onAuthStateChanged(auth, async (user) => {
      const isAdmin = user && normaliseEmail(user.email) === ADMIN_EMAIL;
      loginCard.hidden = Boolean(isAdmin);
      consolePanel.hidden = !isAdmin;
      signout.hidden = !isAdmin;
      statusPill.textContent = isAdmin ? "Signed in" : (user ? "Wrong admin email" : "Not signed in");
      if (isAdmin) {
        setActiveTab("overview");
        if (!dateInput.value) {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          dateInput.value = toDateKey(tomorrow);
        }
        calendarMonth = startOfMonth(parseDateKey(dateInput.value));
        await loadMonthAvailability();
        await loadSingleDate(dateInput.value);
        await loadAgencyPartners();
      } else {
        renderCalendar();
      }
    });

    renderBlocks();
    renderCalendar();
    resetPartnerForm();
