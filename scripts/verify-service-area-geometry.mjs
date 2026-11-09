// Integration smoke check for the external Brisbane River layer used by
// functions-payments/service-area.js. Run from CI before activating online bookings.
const endpoint = "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/waterway_drainage_lines/FeatureServer/0/query";
const params = new URLSearchParams({
  where: "NAME LIKE '%Brisbane%'", outFields: "NAME",
  outSR: "4326", returnGeometry: "true", f: "geojson"
});
const response = await fetch(endpoint + "?" + params, { signal: AbortSignal.timeout(25000) });
if (!response.ok) throw Error("River GIS HTTP error: " + response.status);
const body = await response.json();
if (body.error || body.exceededTransferLimit) throw Error("River GIS error or incomplete result: " + JSON.stringify(body.error || body.exceededTransferLimit));
if (!Array.isArray(body.features) || !body.features.length) throw Error("River GIS had no matching features.");
const names = [...new Set(body.features.map(f => f.properties?.NAME || f.properties?.Name || ""))];
const lines = body.features.flatMap(f => f.geometry?.type === "LineString" ? [f.geometry.coordinates] :
  f.geometry?.type === "MultiLineString" ? f.geometry.coordinates : []);
const points = lines.flat().filter(p => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
if (!points.length) throw Error("River GIS has no GeoJSON coordinates.");
const [minLon,maxLon] = [Math.min(...points.map(p=>p[0])), Math.max(...points.map(p=>p[0]))];
const [minLat,maxLat] = [Math.min(...points.map(p=>p[1])), Math.max(...points.map(p=>p[1]))];
console.log(JSON.stringify({count:body.features.length, names, lines:lines.length, points:points.length, extent:{minLon,maxLon,minLat,maxLat}}));
if (!names.some(n=>/brisbane river/i.test(n))) throw Error("Brisbane River not found in named features.");
if (!(minLat < -27.45 && maxLat > -27.5 && minLon < 153.05 && maxLon > 153.0)) {
  throw Error("GIS geometry does not cover central Brisbane River as expected.");
}
