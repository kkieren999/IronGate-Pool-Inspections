// Live, read-only checkout-eligibility smoke tests.
// No payments or bookings are created. Public website key is used only to obtain
// the same geocoding place ID a customer would select on the booking page.
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../website/js/booking.js", import.meta.url), "utf8");
const key = source.match(/const GEOAPIFY_API_KEY = "([^"]+)"/)?.[1];
if (!key) throw new Error("Public address-autocomplete API key is missing.");
const callable = "https://us-central1-irongate-pool-inspection-256b4.cloudfunctions.net/checkBookingServiceArea";

async function place(query) {
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  for (const [k,v] of Object.entries({ text:query, filter:"countrycode:au", format:"json", limit:"5", apiKey:key })) {
    url.searchParams.set(k,v);
  }
  const response = await fetch(url.toString(), {
    headers: { Referer:"https://irongatepool.com.au/booking/", Origin:"https://irongatepool.com.au" },
    signal:AbortSignal.timeout(25000)
  });
  if (!response.ok) throw Error("Autocomplete provider HTTP "+response.status);
  const data = await response.json();
  const selection = data.results?.find(r => r.place_id && r.formatted && String(r.state||"").toLowerCase().includes("queensland"));
  if (!selection) throw Error("Cannot select a Queensland address for "+query);
  console.log("Autocomplete selected:",selection.formatted);
  return { address:selection.formatted, placeId:selection.place_id };
}

async function check(query, expected) {
  const selection = await place(query);
  const response = await fetch(callable, {
    method:"POST",
    headers: { "Content-Type":"application/json" },
    body:JSON.stringify({ data: selection }),
    signal:AbortSignal.timeout(40000)
  });
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); }
  catch { throw Error("Callable returned non-JSON HTTP "+response.status+" content-type "+response.headers.get("content-type")+
    " response preview: "+raw.slice(0,180).replace(/\s+/g," ")); }
  console.log("Callable:",query,"status",response.status,"result",JSON.stringify(body));
  if (!response.ok || typeof body.result?.eligible !== "boolean") {
    throw Error("Live callable is not returning a valid eligibility response for "+query);
  }
  if (body.result.eligible !== expected) {
    throw Error("Incorrect service-area decision for "+query+": expected "+expected);
  }
}
await check("Mansfield QLD 4122 Australia", true);
await check("Ipswich QLD 4305 Australia", false);
if (process.argv.includes("--regions")) {
  await check("Brisbane City QLD 4000 Australia", true);
  await check("Cleveland QLD 4163 Australia", true);
  await check("Chermside QLD 4032 Australia", false);
  await check("Kenmore QLD 4069 Australia", false);
}
console.log("Live callable service-area sample checks passed.");
