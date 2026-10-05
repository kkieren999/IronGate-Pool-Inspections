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
  assert.equal(node("#pool-owner-section").hidden, true);
  assert.equal(node("#booking-authority-field").hidden, true);
  assert.equal(node("#agency-name-field").hidden, true);
  node("#bookingRole").value = "agent";
  node("#bookingRole").dispatch("change");
  assert.equal(node("#poolOwnerStatus").value, "different");
  assert.equal(node("#pool-owner-section").hidden, false);
  assert.equal(node("#poolOwnerName").required, true);
  assert.equal(node("#poolOwnerEmail").required, true);
  assert.equal(node("#poolOwnerPhone").required, true);
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

test("non-owner roles require full pool owner details and property access remains separate", () => {
  const { node } = roleForm();
  node("#bookingRole").value = "agency"; node("#bookingRole").dispatch("change");
  assert.equal(node("#owner-name-field").hidden, false);
  assert.equal(node("#owner-email-field").hidden, false);
  assert.equal(node("#owner-phone-field").hidden, false);
  assert.equal(node("#poolOwnerName").required, true);
  assert.equal(node("#poolOwnerEmail").required, true);
  assert.equal(node("#poolOwnerPhone").required, true);
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
    poolOwnerStatus: "different", poolOwnerName: "Alex Owner", poolOwnerEmail: "alex@example.com",
    poolOwnerPhone: "0411222333", ownerDetailsPending: false,
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
  assert.equal(data.ownerDetailsPending, false);
  assert.equal(data.poolOwnerStatus, "different");
  assert.equal(data.poolOwnerName, "Alex Owner");
  assert.equal(data.poolOwnerEmail, "alex@example.com");
  assert.equal(data.poolOwnerPhone, "0411222333");
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
    [{ ...good, poolOwnerName: "" }, /owner's name/i],
    [{ ...good, poolOwnerEmail: "" }, /owner email/i],
    [{ ...good, poolOwnerPhone: "" }, /owner contact phone/i],
    [{ ...good, poolOwnerStatus: "pending", ownerDetailsPending: true }, /owner details/i],
    [{ ...good, accessContactPhone: "" }, /contact/],
    [{ ...good, keyCollectionLocation: "" }, /access arrangements/],
    [{ ...good, accessPermissionIfNotHome: false }, /access arrangements/],
    [{ ...good, animalsOnProperty: true, animalsWillBeSecured: false }, /Animals/]
  ];
  for (const [payload, pattern] of bad) {
    assert.throws(() => assertValidBooking(payload), pattern);
  }
});
test("frontend constructs the full agency booking payload for the existing Stripe checkout", () => {
  const source = read("website/js/booking-stripe.js");
  const first = source.indexOf("function validateBookingPayload(payload) {");
  const last = source.indexOf("\nfunction inviteExpired(", first);
  assert.ok(first > 0 && last > first);
  const values = {
    "#bookingRole": "agency", "#agencyName": "Willow Brown",
    "#customerName": "Ken Example", "#email": "ken@example.com", "#phone": "0412345678",
    "#propertyAddress": "20 Example Court, Carindale QLD 4152",
    "#propertyAddressSelected": "true", "#propertyPlaceId": "testplace",
    "#poolOwnerStatus": "different", "#poolOwnerName": "Alex Owner",
    "#poolOwnerEmail": "alex@example.com", "#poolOwnerPhone": "0411222333",
    "#accessContactName": "Sam Example",
    "#accessContactPhone": "07 3397 4280", "#accessContactEmail": "sam@example.com",
    "#accessContactAgency": "Harcourts", "#accessMethod": "keys",
    "#keyCollectionLocation": "15 Example Rd, Coorparoo",
    "#inspectionReason": "Renting or leasing the property", "#poolType": "Swimming pool",
    "#preferredDate": "2099-05-08", "#preferredTimeSlot": "09_00"
  };
  const checked = new Set([
    "#authorisedToBook", "#accessPermissionIfNotHome", "#nonComplianceAcknowledged",
    "#informationAccuracyConfirmed", "#termsAccepted"
  ]);
  const context = {
    privateInvite: null,
    privateInviteToken: "token-test",
    getValue(selector) { return values[selector] || ""; },
    getChecked(selector) { return checked.has(selector); },
    normaliseAustralianMobile: (value) => value,
    selectedSlotDetails: () => ({ id: "09_00", start: "09:00", end: "10:00", label: "9 am - 10 am" }),
    selectedDateDisplay: () => "Friday 8 May",
    isTodayOrPastDateKey: () => false,
    serverTimestamp: () => "timestamp"
  };
  const funcs = runInNewContext(source.slice(first, last) +
    "\n({ validateBookingPayload, collectBookingPayload, privateCustomerUpdate });", context);
  const payload = funcs.collectBookingPayload();
  assert.equal(funcs.validateBookingPayload(payload), "");
  assert.equal(payload.bookingRoleCode, "agency");
  assert.equal(payload.agencyName, "Willow Brown");
  assert.equal(payload.poolOwnerStatus, "different");
  assert.equal(payload.poolOwnerName, "Alex Owner");
  assert.equal(payload.poolOwnerEmail, "alex@example.com");
  assert.equal(payload.poolOwnerPhone, "0411222333");
  assert.equal(payload.ownerDetailsPending, false);
  assert.equal(payload.accessContactName, "Sam Example");
  assert.equal(payload.accessMethod, "keys");
  assert.equal(payload.keyCollectionLocation, "15 Example Rd, Coorparoo");
  const privateUpdate = funcs.privateCustomerUpdate(payload);
  for (const field of ["bookingRoleCode", "agencyName", "poolOwnerStatus",
    "poolOwnerName", "poolOwnerEmail", "poolOwnerPhone", "ownerDetailsPending",
    "accessContactName", "accessMethod", "keyCollectionLocation"]) {
    assert.equal(privateUpdate[field], payload[field], "private invitation field: " + field);
  }
  checked.delete("#authorisedToBook");
  const unapproved = funcs.collectBookingPayload();
  assert.match(funcs.validateBookingPayload(unapproved), /authorised/i);
});
test("backend accepts Australian mobile and landline for agents, with rules matching", () => {
  const { assertValidBooking } = backend();
  for (const phone of ["0412345678", "+61412345678", "07 3397 4280", "+61 7 3397 4280"]) {
    assert.doesNotThrow(() => assertValidBooking({ ...exampleBooking(), phone }), phone);
  }
  const rules = read("firestore.rules");
  assert.equal((rules.match(/function validPrivateInviteBookingUpdate/g) || []).length, 1);
  assert.equal((rules.match(/request\.resource\.data\.phone\.matches/g) || []).length, 2);
  assert.ok(rules.includes("0[2378][0-9]{8}"));
});
test("public and private checkout capture the same booking role and access fields", () => {
  const html = read("website/booking/index.html");
  const stripe = read("website/js/booking-stripe.js");
  const rules = read("firestore.rules");
  const backend = read("functions-payments/direct-booking.js");
  for (const id of ["bookingRole", "agencyName", "poolOwnerStatus", "poolOwnerName",
    "poolOwnerEmail", "poolOwnerPhone", "accessContactName", "accessMethod", "keyCollectionLocation"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  for (const key of ["bookingRoleCode", "poolOwnerPhone", "ownerDetailsPending", "accessContactAgency", "keyCollectionLocation"]) {
    assert.ok(stripe.includes(key), "stripe: " + key);
    assert.ok(backend.includes('"' + key + '"'), "backend: " + key);
    assert.ok(rules.includes('"' + key + '"'), "rules: " + key);
  }
  assert.doesNotMatch(html, /Who should receive the invoice\?/i);
  assert.doesNotMatch(html, /id="exemptionFile"/, "do not advertise a fake upload");
});
