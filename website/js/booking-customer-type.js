// Shared role-based form controls, loaded by booking-stripe.js after the DOM.
const $ = (selector) => document.querySelector(selector);
const role = $("#bookingRole");
const ownerStatus = $("#poolOwnerStatus");
const sameAccess = $("#accessSameAsBooking");
const accessMethod = $("#accessMethod");

function visible(id, show, controls = []) {
  const group = $(id);
  if (group) group.hidden = !show;
  controls.forEach((selector) => {
    const input = $(selector);
    if (!input) return;
    input.required = show;
    if (!show) {
      if (input.type === "checkbox") input.checked = false;
      else input.value = "";
    }
  });
}
function syncOwner() {
  const isOwner = role?.value === "owner";
  if (isOwner) ownerStatus.value = "self";
  else if (ownerStatus.value === "self") ownerStatus.value = "";
  $("#pool-owner-status-field").hidden = isOwner;
  $("#owner-self-note").hidden = !isOwner;
  const different = !isOwner && ownerStatus.value === "different";
  visible("#owner-name-field", different, ["#poolOwnerName"]);
  visible("#owner-email-field", different);
  visible("#owner-pending-note", !isOwner && ownerStatus.value === "pending");
}
function syncRole() {
  const selected = role?.value || "";
  const agency = selected === "agent" || selected === "agency";
  const other = selected === "other";
  const nonOwner = agency || other;
  visible("#agency-name-field", agency, ["#agencyName"]);
  visible("#other-relationship-field", other, ["#bookingRelationship"]);
  visible("#booking-authority-field", nonOwner, ["#authorisedToBook"]);
  syncOwner();
  window.ironGateBookingContext = {
    customerType: agency ? selected : selected === "owner" ? "homeowner" : "other",
    bookingRole: selected
  };
}
function syncAccess() {
  visible("#access-contact-fields", !sameAccess?.checked,
    ["#accessContactName", "#accessContactPhone"]);
  const method = accessMethod?.value || "";
  visible("#key-location-field", method === "keys", ["#keyCollectionLocation"]);
  visible("#access-permission-field",
    method === "keys" || method === "lockbox" || method === "other",
    ["#accessPermissionIfNotHome"]);
}

role?.addEventListener("change", syncRole);
ownerStatus?.addEventListener("change", syncOwner);
sameAccess?.addEventListener("change", syncAccess);
accessMethod?.addEventListener("change", syncAccess);
syncRole();
syncAccess();

// Preserve balanced calendar header in the existing site layout.
const style = document.createElement("style");
style.textContent = ".calendar-header-row{display:grid!important;grid-template-columns:46px minmax(0,1fr) 46px;align-items:center;gap:12px}.calendar-header-row h3,#calendar-title{text-align:center;margin:0!important}.calendar-nav-btn{width:46px!important;height:46px!important;padding:0!important;display:inline-grid!important;place-items:center!important;border-radius:999px!important}";
document.head.appendChild(style);
document.querySelectorAll(".booking-note").forEach((note) => {
  if ((note.textContent || "").toLowerCase().includes("availability manager")) note.remove();
});
