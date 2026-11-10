const { features } = require("./brisbane-sa4-2026.json");

function clean(value) {
  return String(value || "").trim();
}

function comparable(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Returns 0 outside, 1 inside and 2 on an edge. The boundary itself is eligible.
function ringLocation(x, y, ring) {
  let inside = false;
  for (let index = 1; index < ring.length; index++) {
    const [ax, ay] = ring[index - 1];
    const [bx, by] = ring[index];
    if (x >= Math.min(ax, bx) && x <= Math.max(ax, bx) &&
        y >= Math.min(ay, by) && y <= Math.max(ay, by) &&
        Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) < 1e-13) return 2;
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside ? 1 : 0;
}

function covers(x, y, [exterior, ...holes]) {
  const outer = ringLocation(x, y, exterior);
  return outer === 2 || (outer === 1 && !holes.some(ring => ringLocation(x, y, ring) === 1));
}

function regionFor(lon, lat) {
  for (const { geometry, properties } of features) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    if (polygons.some(polygon => covers(lon, lat, polygon))) return properties.SA4_NAME_2026;
  }
  return null;
}

async function evaluateServiceArea({ address, placeId, apiKey, fetchImpl = fetch }) {
  const formatted = clean(address);
  const selectedId = clean(placeId);
  if (!formatted || formatted.length > 300 || !selectedId || selectedId.length > 300) {
    return { eligible: false, reason: "unverified_address" };
  }
  if (!clean(apiKey)) throw new Error("Service-area geocoding is not configured.");

  const url = new URL("https://api.geoapify.com/v1/geocode/search");
  url.search = new URLSearchParams({ text: formatted, format: "json", filter: "countrycode:au", limit: "5", apiKey });
  const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Service-area data provider unavailable: " + response.status);
  const data = await response.json();
  if (data.error) throw new Error("Service-area data provider returned an error.");

  // Resolve coordinates server-side. A postcode, suburb label or browser-supplied coordinates cannot override the boundary.
  const candidates = Array.isArray(data.results) ? data.results : [];
  const location = candidates.find(item => item.place_id === selectedId) ||
    candidates.find(item => comparable(item.formatted) === comparable(formatted));
  if (!location || String(location.country_code || "").toLowerCase() !== "au" ||
      !["queensland", "qld"].includes(String(location.state || location.state_code || "").toLowerCase()) ||
      !Number.isFinite(location.lon) || !Number.isFinite(location.lat)) {
    return { eligible: false, reason: "unverified_address" };
  }
  const region = regionFor(location.lon, location.lat);
  return region ? { eligible: true, reason: "within_area", region } : { eligible: false, reason: "outside_regions" };
}

module.exports = { evaluateServiceArea, regionFor };
