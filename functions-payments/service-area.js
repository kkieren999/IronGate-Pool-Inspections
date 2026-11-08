// Internal policy only: public responses never disclose the river-bank restriction.
// Mansfield suburb-centre reference point; travel times use driving routes, not radius.
const MANSFIELD = [-27.53929, 153.09895]; // [latitude, longitude]
const MAX_DRIVE_SECONDS = 25 * 60;
const RIVER_DATASET = "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/waterway_drainage_lines/FeatureServer/0/query";
let cachedRiver = null;

function clean(value) {
  return String(value || "").trim();
}

function comparable(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function jsonGet(base, params, fetchImpl) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const response = await fetchImpl(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("Service-area data provider unavailable: " + response.status);
  const json = await response.json();
  if (json.error) throw new Error("Service-area data provider returned an error.");
  return json;
}

function lineStrings(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function crossingPoint(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-12) return null;
  const ca = [c[0] - a[0], c[1] - a[1]];
  const t = cross(ca, s) / denominator;
  const u = cross(ca, r) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

function riverCrossingCount(routeLines, riverLines) {
  const crossings = [];
  for (const route of routeLines) {
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      for (const river of riverLines) {
        for (let j = 1; j < river.length; j++) {
          const c = river[j - 1], d = river[j];
          const intersection = crossingPoint(a, b, c, d);
          if (!intersection) continue;
          // Duplicate line segments in the GIS dataset can record one bridge twice.
          if (!crossings.some((p) =>
            (p[0] - intersection[0]) ** 2 + (p[1] - intersection[1]) ** 2 < 0.00000004)) {
            crossings.push(intersection);
          }
        }
      }
    }
  }
  return crossings.length;
}

async function loadBrisbaneRiver(fetchImpl) {
  if (cachedRiver) return cachedRiver;
  const data = await jsonGet(RIVER_DATASET, {
    where: "NAME LIKE '%Brisbane%'",
    outFields: "NAME",
    outSR: "4326",
    returnGeometry: "true",
    f: "geojson"
  }, fetchImpl);
  if (data.exceededTransferLimit) throw new Error("Incomplete river geometry.");
  const features = Array.isArray(data.features) ? data.features : [];
  const lines = features
    .filter((feature) => /brisbane river/i.test(feature.properties?.NAME || feature.properties?.Name || ""))
    .flatMap((feature) => lineStrings(feature.geometry))
    .filter((line) => line.length >= 2);
  if (!lines.length) throw new Error("Brisbane River geometry is unavailable.");
  // Cache only successfully retrieved geography. A failed fetch must not create
  // an 'eligible' result with a missing river restriction.
  cachedRiver = lines;
  return lines;
}

async function evaluateServiceArea({ address, placeId, apiKey, fetchImpl = fetch }) {
  const formatted = clean(address);
  const selectedId = clean(placeId);
  if (!formatted || formatted.length > 300 || !selectedId || selectedId.length > 300) {
    return { eligible: false, reason: "unverified_address" };
  }
  if (!clean(apiKey)) throw new Error("Service-area routing is not configured.");

  // Re-geocode on the SERVER: coordinates and prior approval supplied by the
  // browser must never be trusted when opening Stripe Checkout.
  const geocode = await jsonGet("https://api.geoapify.com/v1/geocode/search", {
    text: formatted, format: "json", filter: "countrycode:au", limit: "5",
    apiKey
  }, fetchImpl);
  const candidates = Array.isArray(geocode.results) ? geocode.results : [];
  const location = candidates.find((item) => item.place_id === selectedId) ||
    candidates.find((item) => comparable(item.formatted) === comparable(formatted));
  if (!location ||
      String(location.country_code || "").toLowerCase() !== "au" ||
      !["queensland", "qld"].includes(String(location.state || location.state_code || "").toLowerCase()) ||
      !Number.isFinite(Number(location.lat)) || !Number.isFinite(Number(location.lon))) {
    return { eligible: false, reason: "unverified_address" };
  }

  const routeData = await jsonGet("https://api.geoapify.com/v1/routing", {
    waypoints: MANSFIELD.join(",") + "|" + [location.lat, location.lon].join(","),
    mode: "drive", traffic: "approximated", apiKey
  }, fetchImpl);
  const route = routeData.features?.[0];
  const seconds = Number(route?.properties?.time);
  const routeLines = lineStrings(route?.geometry);
  if (!Number.isFinite(seconds) || seconds < 0 || !routeLines.length) {
    throw new Error("A driving route could not be verified.");
  }
  if (seconds > MAX_DRIVE_SECONDS) {
    return { eligible: false, reason: "driving_time", driveSeconds: seconds };
  }

  // An odd number of crossings from Mansfield means the property is on the
  // opposite bank. The route includes bridges and river tunnels; do not expose
  // this internal condition to the customer-facing form or website copy.
  const riverLines = await loadBrisbaneRiver(fetchImpl);
  const crossings = riverCrossingCount(routeLines, riverLines);
  if (crossings % 2 !== 0) {
    return { eligible: false, reason: "river_bank", driveSeconds: seconds };
  }
  return { eligible: true, reason: "within_area", driveSeconds: seconds };
}

module.exports = {
  MANSFIELD, MAX_DRIVE_SECONDS, evaluateServiceArea,
  riverCrossingCount, lineStrings
};
