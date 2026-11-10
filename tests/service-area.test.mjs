import test from "node:test";
import assert from "node:assert/strict";
import { regionFor, evaluateServiceArea } from "../functions-payments/service-area.js";

const samples = [
  ["Brisbane City", 153.026, -27.4698, "Brisbane Inner City"],
  ["Fortitude Valley", 153.034, -27.452, "Brisbane Inner City"],
  ["Cleveland", 153.265, -27.526, "Brisbane - East"],
  ["Mansfield", 153.099, -27.5393, "Brisbane - South"],
  ["Chermside", 153.033, -27.385, null],
  ["Kenmore", 152.939, -27.492, null],
  ["Ipswich", 152.76, -27.614, null],
  ["Logan Central", 153.113, -27.635, null]
];

for (const [name, lon, lat, region] of samples) {
  test(name + " uses the ABS boundary", async () => {
    assert.equal(regionFor(lon, lat), region);
    const result = await evaluateServiceArea({
      address: name, placeId: "selected", apiKey: "test",
      fetchImpl: async url => {
        assert.equal(new URL(url).pathname, "/v1/geocode/search");
        return { ok: true, json: async () => ({
          results: [{ place_id: "selected", formatted: name, state: "Queensland", country_code: "au", lon, lat }]
        }) };
      }
    });
    assert.equal(result.eligible, Boolean(region));
    assert.equal(result.region ?? null, region);
  });
}

test("unverified coordinates or unrelated address results cannot proceed", async () => {
  for (const candidate of [
    { place_id: "other", formatted: "Another address", lon: 153.099, lat: -27.5393 },
    { place_id: "selected", formatted: "Mansfield", lon: null, lat: null }
  ]) {
    const result = await evaluateServiceArea({
      address: "Mansfield", placeId: "selected", apiKey: "test",
      fetchImpl: async () => ({ ok: true, json: async () => ({
        results: [{ ...candidate, state: "Queensland", country_code: "au" }]
      }) })
    });
    assert.equal(result.reason, "unverified_address");
  }
});

test("geocoding failures fail closed", async () => {
  await assert.rejects(() => evaluateServiceArea({
    address: "Mansfield", placeId: "selected", apiKey: "test",
    fetchImpl: async () => ({ ok: false, status: 503 })
  }), /503/);
});
