const fs = require("node:fs");
const endpoint = "https://geo.abs.gov.au/arcgis/rest/services/ASGS2026/SA4/MapServer/0/query";
const names = ["Brisbane Inner City", "Brisbane - East", "Brisbane - South"];
const url = new URL(endpoint);
url.search = new URLSearchParams({
  where: "SA4_NAME_2026 IN (" + names.map(name => "'" + name + "'").join(",") + ")",
  outFields: "SA4_CODE_2026,SA4_NAME_2026",
  outSR: "4326",
  geometryPrecision: "7",
  f: "geojson"
});
async function main() {
  const response = await fetch(url);
  if (!response.ok) throw Error("ABS request failed: " + response.status);
  const data = await response.json();
  if (data.features?.length !== names.length || data.exceededTransferLimit) throw Error(JSON.stringify(data).slice(0,500));
  const result = {
    source: "Australian Bureau of Statistics, ASGS Edition 4 (2026), Statistical Areas Level 4 (SA4)",
    url: endpoint,
    features: data.features
  };
  const out = JSON.stringify(result) + "\n";
  fs.writeFileSync("functions-payments/brisbane-sa4-2026.json", out);
  console.log(out.length, data.features.map(f=>[f.properties, f.geometry.type]));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
