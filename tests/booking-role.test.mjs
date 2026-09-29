import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

function roleForm() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) {
      const listeners = new Map();
      nodes.set(id, {
        id, value: "", checked: false, required: false, hidden: false,
        type: id === "#accessSameAsBooking" || id === "#authorisedToBook" || id === "#accessPermissionIfNotHome" ? "checkbox" : "text",
        addEventListener(event, handler) { listeners.set(event, handler); },
        dispatch(event) { listeners.get(event)?.(); }
      });
    }
    return nodes.get(id);
  }
  node("#accessSameAsBooking").checked = true;
  const document = {
    querySelector: node,
    createElement() { return { textContent: "" }; },
    head: { appendChild() {} },
    querySelectorAll() { return []; }
  };
  const window = {};
  runInNewContext(read("website/js/booking-customer-type.js"), { document, window });
  return { node, window };
}

test("role dropdown reveals only relevant company, relationship and authority fields", () => {
  const { node, window } = roleForm();
  node("#bookingRole").value = "owner";
  node("#bookingRole").dispatch("change");
  assert.equal(node("#poolOwnerStatus").value, "self");
  assert.equal(node("#pool-owner-status-field").hidden, true);
  assert.equal(node("#booking-authority-field").hidden, true);
  assert.equal(node("#agency-name-field").hidden, true);
  node("#bookingRole").value = "agent";
  node("#bookingRole").dispatch("change");
  assert.equal(node("#poolOwnerStatus").value, "");
  assert.equal(node("#pool-owner-status-field").hidden, false);
  assert.equal(node("#agency-name-field").hidden, false);
  assert.equal(node("#agencyName").required, true);
  assert.equal(node("#booking-authority-field").hidden, false);
  assert.equal(node("#authorisedToBook").required, true);
  assert.equal(window.ironGateBookingContext.customerType, "agent");
  node("#bookingRole").value = "other";
  node("#bookingRole").dispatch("change");
  assert.equal(node("#agency-name-field").hidden, true);
  assert.equal(node("#agencyName").value, "");
  assert.equal(node("#other-relationship-field").hidden, false);
  assert.equal(node("#bookingRelationship").required, true);
});

test("owner and property access selectors make only relevant fields required", () => {
  const { node } = roleForm();
  node("#bookingRole").value = "agency"; node("#bookingRole").dispatch("change");
  node("#poolOwnerStatus").value = "different"; node("#poolOwnerStatus").dispatch("change");
  assert.equal(node("#owner-name-field").hidden, false);
  assert.equal(node("#poolOwnerName").required, true);
  node("#poolOwnerStatus").value = "pending"; node("#poolOwnerStatus").dispatch("change");
  assert.equal(node("#owner-name-field").hidden, true);
  assert.equal(node("#owner-pending-note").hidden, false);
  assert.equal(node("#poolOwnerName").required, false);
  node("#accessSameAsBooking").checked = false; node("#accessSameAsBooking").dispatch("change");
  assert.equal(node("#access-contact-fields").hidden, false);
  assert.equal(node("#accessContactName").required, true);
  assert.equal(node("#accessContactPhone").required, true);
  assert.equal(node("#accessContactEmail").required, false);
  node("#accessMethod").value = "keys"; node("#accessMethod").dispatch("change");
  assert.equal(node("#keyCollectionLocation").required, true);
  assert.equal(node("#accessPermissionIfNotHome").required, true);
  node("#accessMethod").value = "on_site"; node("#accessMethod").dispatch("change");
  assert.equal(node("#key-location-field").hidden, true);
  assert.equal(node("#access-permission-field").hidden, true);
});

function backend() {
  const admin = { firestore: { FieldValue: { serverTimestamp: () => "timestamp" } } };
  const code = read("functions-payments/direct-booking.js");
  const env = { require(name) {
    if (name !== "firebase-admin") throw Error("Unexpected module " + name);
    return admin;
  }, module: { exports: {} } };
  return runInNewContext(code + "\n({ assertValidBooking, publicBookingData });", env);
}
function exampleBooking() {
  return {
    bookingRoleCode: "agency", agencyName: "Willow Brown",
    customerName: "Ken Example", email: "ken@example.com", phone: "0412345678",
    propertyAddress: "20 Example Court, Carindale QLD 4152", propertyAddressSelected: true,
    isPropertyOwner: false, authorisedToBook: true,
    poolOwnerStatus: "pending", poolOwnerName: "", poolOwnerEmail: "", ownerDetailsPending: true,
    accessSameAsBooking: false, accessContactName: "Sam Example",
    accessContactPhone: "0733974280", accessContactEmail: "sam@example.com",
    accessContactAgency: "Harcourts", accessMethod: "keys",
    keyCollectionLocation: "15 Example Rd, Coorparoo", accessPermissionIfNotHome: true,
    animalsOnProperty: false, preferredDate: "2099-05-08", preferredTimeSlot: "09_00",
    preferredTimeStart: "09:00", preferredTimeEnd: "10:00",
    termsAccepted: true, privacyAccepted: true
  };
}
test("backend accepts an authorised agency job without mislabelling it a homeowner", () => {
  const { assertValidBooking, publicBookingData } = backend();
  const booking = exampleBooking();
  assert.doesNotThrow(() => assertValidBooking(booking));
  const data = publicBookingData(booking, {
    serviceName: "Pool Safety Inspection & Certificate", priceCents: 14900,
    priceDisplay: "$149", currency: "aud"
  });
  assert.equal(data.customerType, "agency");
  assert.equal(data.bookingRole, "Agency / organisation representative");
  assert.equal(data.agencyName, "Willow Brown");
  assert.equal(data.ownerDetailsPending, true);
  assert.equal(data.poolOwnerStatus, "pending");
  assert.equal(data.accessContactName, "Sam Example");
  assert.equal(data.paymentStatus, "checkout_created");
});
test("backend rejects missing role authority, owner identity, access and animal safety", () => {
  const { assertValidBooking } = backend();
  const good = exampleBooking();
  const bad = [
    [{ ...good, bookingRoleCode: "" }, /role/],
    [{ ...good, agencyName: "" }, /agency/],
    [{ ...good, authorisedToBook: false }, /authority/],
    [{ ...good, poolOwnerStatus: "different", ownerDetailsPending: false }, /owner's name/],
    [{ ...good, ownerDetailsPending: false }, /Outstanding owner/],
    [{ ...good, accessContactPhone: "" }, /contact/],
    [{ ...good, keyCollectionLocation: "" }, /access arrangements/],
    [{ ...good, accessPermissionIfNotHome: false }, /access arrangements/],
    [{ ...good, animalsOnProperty: true, animalsWillBeSecured: false }, /Animals/]
  ];
  for (const [payload, pattern] of bad) {
    assert.throws(() => assertValidBooking(payload), pattern);
  }
});
test("public and private checkout capture the same booking role and access fields", () => {
  const html = read("website/booking/index.html");
  const stripe = read("website/js/booking-stripe.js");
  const rules = read("firestore.rules");
  const backend = read("functions-payments/direct-booking.js");
  for (const id of ["bookingRole", "agencyName", "poolOwnerStatus", "poolOwnerName",
    "accessContactName", "accessMethod", "keyCollectionLocation"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const key of ["bookingRoleCode", "ownerDetailsPending", "accessContactAgency", "keyCollectionLocation"]) {
    assert.ok(stripe.includes(key), "stripe: " + key);
    assert.ok(backend.includes('"' + key + '"'), "backend: " + key);
    assert.ok(rules.includes('"' + key + '"'), "rules: " + key);
  }
  assert.doesNotMatch(html, /Who should receive the invoice\?/i);
  assert.doesNotMatch(html, /id="exemptionFile"/, "do not advertise a fake upload");
});
