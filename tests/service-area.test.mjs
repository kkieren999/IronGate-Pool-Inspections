import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { evaluateServiceArea, riverCrossingCount, MAX_DRIVE_SECONDS } =
  require("../functions-payments/service-area.js");

const address = "10 Example Street, Mansfield QLD 4122, Australia";
const origin = [153.09895, -27.53929];
const river = [[153.08, -27.52], [153.12, -27.52]];
function mockFetch({ seconds = 1200, path = [origin, [153.11, -27.54]], match = true } = {}) {
  return async (url) => {
    const parsed = new URL(url);
    let body;
    if (parsed.pathname.includes("/geocode/search")) {
      body = { results: [{
        formatted: match ? address : "Different Street, QLD, Australia",
        place_id: match ? "selected-address" : "other-address",
        country_code: "au", state: "Queensland", lat: -27.53, lon: 153.11
      }] };
    } else if (parsed.pathname.includes("/routing")) {
      assert.equal(parsed.searchParams.get("mode"), "drive");
      assert.equal(parsed.searchParams.get("traffic"), "approximated");
      body = { features: [{
        properties: { time: seconds },
        geometry: { type: "MultiLineString", coordinates: [path] }
      }] };
    } else if (parsed.pathname.endsWith("/query")) {
      body = { features: [{
        properties: { NAME: "Brisbane River" },
        geometry: { type: "LineString", coordinates: river }
      }] };
    } else {
      throw new Error("Unexpected service-area request: " + url);
    }
    return { ok: true, json: async () => body };
  };
}

function check(options = {}) {
  return evaluateServiceArea({
    address, placeId: "selected-address", apiKey: "test-key", fetchImpl: mockFetch(options)
  });
}

test("25-minute driving cutoff includes exactly 25 minutes", async () => {
  assert.equal(MAX_DRIVE_SECONDS, 1500);
  const result = await check({ seconds: 1500 });
  assert.equal(result.eligible, true);
});

test("drive time over 25 minutes must not proceed", async () => {
  const result = await check({ seconds: 1501 });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "driving_time");
});

test("crossing the Brisbane River from the Mansfield side blocks online checkout", async () => {
  assert.equal(riverCrossingCount([[origin, [153.10, -27.49]]], [river]), 1);
  const result = await check({ path: [origin, [153.10, -27.49]] });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "river_bank");
});

test("south-bank routes remain eligible, and duplicate river geometry does not double count", async () => {
  assert.equal(riverCrossingCount([[origin, [153.10, -27.49]]], [river, river]), 1);
  const result = await check({ path: [origin, [153.13, -27.53]] });
  assert.equal(result.eligible, true);
});

test("unverified addresses fail closed rather than picking a different property", async () => {
  const result = await check({ match: false });
  assert.equal(result.eligible, false);
  assert.equal(result.reason, "unverified_address");
});

test("provider failures fail closed", async () => {
  await assert.rejects(() => evaluateServiceArea({
    address, placeId: "selected-address", apiKey: "",
    fetchImpl: mockFetch()
  }), /not configured/);
});
