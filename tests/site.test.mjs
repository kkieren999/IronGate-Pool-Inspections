import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
  assert.ok(admin.includes('src="/js/admin-console.js"'));
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
