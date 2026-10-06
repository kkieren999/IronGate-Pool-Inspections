import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(root, process.env.SITE_ROOT || "website");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const siteRead = (p) => readFileSync(resolve(site, p), "utf8");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

test("production folder, domain and original public routes", () => {
  assert.ok(existsSync(site));
  assert.ok(!existsSync(resolve(root, "irongate_rebuilt_site_20260623_093017")));
  for (const route of ["index.html", "404.html", "booking/index.html", "admin/index.html",
    "success/index.html", "cancelled/index.html", "privacy/index.html",
    "refunds/index.html", "terms/index.html", "homeowner-checklist/index.html",
    "pool-safety-inspector-brisbane/index.html", "agency-booking-received/index.html"]) {
    assert.ok(existsSync(resolve(site, route)), route + " missing");
  }
  assert.equal(read("CNAME").trim(), "irongatepool.com.au");
  if (process.env.SITE_ROOT === "public") assert.equal(siteRead("CNAME"), read("CNAME"));
});

test("historical html entry points still redirect", () => {
  const redirects = {
    "booking.html": "/booking/", "admin-availability.html": "/admin/",
    "admin-timeblocks.html": "/admin/", "success.html": "/success/",
    "cancelled.html": "/cancelled/", "privacy.html": "/privacy/",
    "refunds.html": "/refunds/", "terms.html": "/terms/",
    "agency-booking-received.html": "/agency-booking-received/"
  };
  for (const [page, target] of Object.entries(redirects)) {
    assert.ok(siteRead(page).includes("url=" + target), page + " must redirect to " + target);
  }
});

test("HTML/CSS assets and JavaScript relative imports exist", () => {
  const host = "https://irongatepool.com.au/";
  for (const path of files(site)) {
    const rel = relative(site, path).replaceAll("\\", "/");
    const contents = readFileSync(path, "utf8");
    if (rel.endsWith(".html")) {
      const pageUrl = new URL(rel, host);
      const htmlBase = contents.match(/<base\s+href=["']([^"']+)["']/i);
      const base = htmlBase ? new URL(htmlBase[1], pageUrl) : pageUrl;
      for (const tag of contents.match(/<(?:script|img|link|source)\b[^>]*>/gi) || []) {
        if (/^<link/i.test(tag) && !/rel=["'](?:stylesheet|icon)["']/i.test(tag)) continue;
        const attr = tag.match(/\b(?:src|href)=["']([^"']+)["']/i);
        if (!attr) continue;
        const value = attr[1];
        if (/^(?:https?:|data:|\/\/)/i.test(value)) continue;
        if (value === "assets/irongate-pool-inspection-overview.mp4") continue; // Unuploaded hero video.
        const target = new URL(value, base);
        if (target.origin !== new URL(host).origin) continue;
        assert.ok(existsSync(resolve(site, decodeURIComponent(target.pathname.slice(1)))), rel + " -> " + value);
      }
    }
    if (rel.endsWith(".css")) {
      for (const m of contents.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
        const value = m[1];
        if (/^(?:https?:|data:|\/\/)/i.test(value)) continue;
        const target = new URL(value, new URL(rel, host));
        assert.ok(existsSync(resolve(site, decodeURIComponent(target.pathname.slice(1)))), rel + " -> " + value);
      }
    }
    if (rel.endsWith(".js")) {
      const imports = [...contents.matchAll(/\bimport\s*(?:\(\s*)?["'](\.[^"']+\.js)["']/g),
        ...contents.matchAll(/\bfrom\s+["'](\.[^"']+\.js)["']/g)];
      for (const match of imports) {
        assert.ok(existsSync(resolve(dirname(path), match[1])), rel + " -> " + match[1]);
      }
    }
  }
});

test("single checkout handler and active private-admin module", () => {
  const ui = siteRead("js/booking.js"), checkout = siteRead("js/booking-stripe.js");
  const admin = siteRead("admin/index.html"), adminJs = siteRead("js/admin-console.js");
  assert.ok(!ui.includes("handleBookingSubmit"));
  assert.ok(!ui.includes('addEventListener("submit"'));
  assert.ok(checkout.includes('addEventListener("submit", handleBackendBookingSubmit)'));
  assert.ok(checkout.includes('httpsCallable(functions, "createBookingCheckoutSession")'));
  assert.ok(checkout.includes("handlePrivateBookingCheckout"));
  assert.ok(admin.includes('src="/js/admin-console.js?v=20261007legacy1"'));
  assert.ok(adminJs.includes('import "./admin-private-booking.js"'));
  assert.ok(adminJs.includes('from "./firebase-config.js"'));
  assert.ok(!siteRead("js/firebase-config.js").includes('pathname.startsWith("/admin")'));
});

test("retired source is absent while current backend exports remain", () => {
  for (const p of ["js/admin-availability.js", "js/admin-bookings.js",
    "js/booking-direct-checkout.js", "js/retry-payment.js",
    "firestore.rules", "README-FIRST.txt", "assets/hero_image.png"]) {
    assert.ok(!existsSync(resolve(site, p)), p + " should not ship");
  }
  assert.ok(!existsSync(resolve(root, "functions/booking-email.js")));
  assert.ok(!existsSync(resolve(root, "docs/CNAME")));
  assert.ok(!read("functions/index.js").includes("queueBookingNotificationEmail"));
  assert.ok(read("functions/index.js").includes("exports.poolRegisterLookup"));
  assert.ok(read("functions-email/index.js").includes("exports.bookingNotificationEmail"));
  assert.ok(read("functions-payments/index.js").includes("exports.createBookingCheckoutSession"));
  assert.ok(read("functions-payments/index.js").includes("exports.stripeWebhook"));
  assert.ok(!read("functions-payments/index.js").includes("exports.createBookingAndCheckoutSession"));
});

test("obsolete inspection pricing is absent", () => {
  for (const p of files(site)) {
    if (!/\.(html|js|css|txt)$/.test(p)) continue;
    assert.ok(!/\$249\b|24900\b/.test(readFileSync(p, "utf8")), relative(site, p) + " has old price");
  }
  assert.ok(siteRead("booking/index.html").includes("$149"));
});

test("all frontend and backend JavaScript parses on Node 22", () => {
  const dirs = [site, ...["functions", "functions-availability", "functions-calendar",
    "functions-email", "functions-payments"].map((d) => resolve(root, d))];
  for (const dir of dirs) {
    for (const p of files(dir).filter((p) => p.endsWith(".js"))) {
      const result = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
      assert.equal(result.status, 0, relative(root, p) + "\n" + result.stderr);
    }
  }
});

test("licence number is correct in source, without a runtime patch shim", () => {
  assert.ok(!existsSync(resolve(site, "js/site-licence.js")));
  assert.ok(!siteRead("js/booking-stripe.js").includes("site-licence.js"));
  assert.ok(siteRead("booking/index.html").includes("PS15616387"));
  for (const p of files(site).filter((p) => p.endsWith(".html"))) {
    assert.ok(!/PSI\s*000000/i.test(readFileSync(p, "utf8")), relative(site, p) + " has placeholder licence");
  }
});

test("address autocomplete requests Geoapify, selects a suggestion, and unlocks the pool-register-confirmed form", async () => {
  // Run the actual browser module against a minimal DOM. The calendar's Firebase
  // network request is unrelated to this test and is the only startup call skipped.
  const source = siteRead("js/booking.js");
  assert.match(source, /^loadAvailabilityForMonth\(\);$/m);
  const runtimeSource = source.replace(/^loadAvailabilityForMonth\(\);$/m, "");

  function element() {
    const listeners = new Map();
    const item = {
      value: "", hidden: false, disabled: false, checked: false, dataset: {},
      children: [], textContent: "", _html: "",
      classList: { toggle() {}, add() {} },
      addEventListener(type, listener) { listeners.set(type, listener); },
      dispatch(type) { return listeners.get(type)?.(); },
      appendChild(child) { this.children.push(child); },
      contains(node) { return this === node; },
      setAttribute() {}, insertAdjacentElement(_where, node) { this.nextElementSibling = node; },
      querySelector(selector) {
        if (!this._html.includes('id="' + selector.slice(1) + '"')) return null;
        this._dynamic ||= new Map();
        if (!this._dynamic.has(selector)) this._dynamic.set(selector, element());
        return this._dynamic.get(selector);
      },
      querySelectorAll() { return []; },
      set innerHTML(value) { this._html = value; this._dynamic = new Map(); this.children = []; },
      get innerHTML() { return this._html; }
    };
    return item;
  }

  const nodes = new Map();
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const propertyFields = element(), contactSection = element();
  const propertySection = element(), laterSection = element();
  const form = byId("#booking-form");
  const continueButton = byId("#booking-submit");
  propertySection.querySelectorAll = () => [propertyFields];
  form.querySelectorAll = (selector) => selector === ".form-section"
    ? [contactSection, propertySection, laterSection] : [];
  form.querySelector = (selector) => selector === '[aria-labelledby="property-details-heading"]'
    ? propertySection : null;
  const scheduled = [];
  const calls = [];
  const document = {
    querySelector(selector) { return selector === "#pool-register-styles" ? null : byId(selector); },
    createElement() { return element(); },
    addEventListener() {},
    head: { appendChild() {} }
  };
  const suggestion = {
    formatted: "10 Example Street, Paddington QLD 4064, Australia",
    address_line1: "10 Example Street", housenumber: "10", street: "Example",
    suburb: "Paddington", postcode: "4064", place_id: "example-place", country: "Australia"
  };
  const registerRecord = {
    _id: 1, "Street Number": "10", "Street Name": "EXAMPLE",
    "Street Type": "STREET", Suburb: "PADDINGTON", "Post Code": "4064",
    "Number of Pools": "1"
  };
  const context = {
    document, URLSearchParams, console,
    window: {
      clearTimeout() {},
      setTimeout(callback) { scheduled.push(callback); return scheduled.length; }
    },
    async fetch(url) {
      calls.push(String(url));
      if (String(url).includes("api.geoapify.com")) {
        return { ok: true, async json() { return { results: [suggestion] }; } };
      }
      if (String(url).includes("data.qld.gov.au")) {
        return { ok: true, async json() { return { success: true, result: { records: [registerRecord] } }; } };
      }
      throw Error("Unexpected external request: " + url);
    }
  };

  assert.doesNotThrow(() => runInNewContext(runtimeSource, context, { filename: "booking.js" }));
  assert.equal(propertyFields.hidden, true, "later property fields should initially be gated");
  assert.equal(laterSection.hidden, true, "later sections should initially be gated");
  assert.equal(continueButton.hidden, true, "checkout should initially be gated");

  const address = byId("#propertyAddress");
  address.value = "10 Example Street Paddington";
  assert.doesNotThrow(() => address.dispatch("input"), "typing must not throw before scheduling autocomplete");
  assert.equal(scheduled.length, 1, "typing schedules a lookup");
  await scheduled.pop()();
  assert.ok(calls.some((url) => url.includes("api.geoapify.com/v1/geocode/autocomplete")));
  assert.equal(byId("#address-suggestions").hidden, false, "suggestions should become visible");
  const option = byId("#address-suggestions").children[0];
  assert.equal(option.textContent, suggestion.formatted);
  option.dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(address.value, suggestion.formatted);
  assert.equal(byId("#propertyAddressSelected").value, "true");
  assert.equal(byId("#propertyPlaceId").value, suggestion.place_id);
  assert.ok(calls.some((url) => url.includes("data.qld.gov.au/api/3/action/datastore_search")));
  const poolPanel = byId("#address-status").nextElementSibling;
  assert.equal(poolPanel.dataset.status, "registered", "register details should appear after selection");

  const confirmation = poolPanel.querySelector("#poolRegisterLooksRight");
  assert.ok(confirmation, "registered pool must ask for customer confirmation");
  confirmation.checked = true;
  confirmation.dispatch("change");
  assert.equal(propertyFields.hidden, false);
  assert.equal(laterSection.hidden, false);
  assert.equal(continueButton.hidden, false, "checkout should unlock only after pool-register confirmation");
});

test("admin booking tabs retain availability and limit customer data to authenticated reads", () => {
  const page = siteRead("admin/index.html");
  const main = siteRead("js/admin-console.js");
  const dashboard = siteRead("js/admin-booking-dashboard.js");
  for (const tab of ["overview", "bookings", "availability", "payments", "partners", "systems"]) {
    assert.ok(page.includes('id="panel-' + tab + '"'), tab);
    assert.ok(page.includes('data-tab="' + tab + '"'), tab);
  }
  assert.ok(main.includes('import "./admin-booking-dashboard.js?v=20261007legacy1"'));
  assert.ok(!dashboard.includes("\\nimport"), "admin dashboard must not contain a literal backslash-n before an import");
  assert.ok(dashboard.includes('onAuthStateChanged(auth'));
  assert.ok(dashboard.includes('orderBy("createdAt", "desc")'));
  assert.ok(dashboard.includes('limit(150)'));
  assert.ok(!dashboard.includes("updateDoc(") && !dashboard.includes("deleteDoc("));
  assert.ok(dashboard.includes('httpsCallable(functions, "adminReconcileBookingBilling")'));
  assert.ok(dashboard.includes('httpsCallable(functions, "adminIssueBookingInvoice")'));
  assert.ok(dashboard.includes('httpsCallable(functions, "adminPrepareInvoiceStripePayment")'));
  assert.ok(dashboard.includes('httpsCallable(functions, "adminUpdateBookingDetails")'));
  assert.ok(dashboard.includes('stripePaymentStatus === "paid"'), "legacy paid bookings remain importable into BarrierCheck");
  assert.ok(dashboard.includes('paid && Boolean(booking.preferredDate) && Boolean(booking.propertyAddress)'), "legacy bookings can use paid appointment data when status predates the current schema");
  assert.ok(dashboard.includes("INVOICE100"));
  assert.ok(dashboard.includes("Pay securely with Stripe"));
  assert.ok(!dashboard.includes("BSB:"));
  assert.ok(!dashboard.includes("Account number:"));
  assert.ok(page.includes('id="finance-stripe-paid"'));
  assert.ok(page.includes('id="finance-invoice-required"'));
  assert.ok(page.includes('id="finance-invoice-paid"'));
  assert.ok(page.includes('id="day-form"') && page.includes('id="partner-form"'));
});
