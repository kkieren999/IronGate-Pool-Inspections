const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const RESOURCE_ID = "bb059c35-d826-4ccd-af31-24de4716864a";
const DATASTORE_SEARCH_URL = "https://www.data.qld.gov.au/api/3/action/datastore_search";
const ALLOWED_ORIGINS = new Set([
  "https://kkieren999.github.io",
  "http://localhost:5000",
  "http://localhost:5001",
  "http://localhost:5173",
  "http://127.0.0.1:5000",
  "http://127.0.0.1:5173"
]);

const STREET_TYPE_MAP = {
  "ALLEY": "ALLEY", "ALLY": "ALLEY",
  "AV": "AVENUE", "AVE": "AVENUE", "AVENUE": "AVENUE",
  "BVD": "BOULEVARD", "BLVD": "BOULEVARD", "BOULEVARD": "BOULEVARD",
  "CCT": "CIRCUIT", "CIRCUIT": "CIRCUIT",
  "CL": "CLOSE", "CLOSE": "CLOSE",
  "CT": "COURT", "COURT": "COURT",
  "CRES": "CRESCENT", "CR": "CRESCENT", "CRESCENT": "CRESCENT",
  "DR": "DRIVE", "DRIVE": "DRIVE",
  "ESPL": "ESPLANADE", "ESPLANADE": "ESPLANADE",
  "HWY": "HIGHWAY", "HIGHWAY": "HIGHWAY",
  "LANE": "LANE", "LN": "LANE",
  "PDE": "PARADE", "PARADE": "PARADE",
  "PL": "PLACE", "PLACE": "PLACE",
  "RD": "ROAD", "ROAD": "ROAD",
  "ST": "STREET", "STREET": "STREET",
  "TCE": "TERRACE", "TERRACE": "TERRACE",
  "WAY": "WAY"
};

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", "https://kkieren999.github.io");
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Max-Age", "3600");
}

function cleanText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseStreetType(value) {
  const cleaned = cleanText(value).replace(/\./g, "");
  return STREET_TYPE_MAP[cleaned] || cleaned;
}

function normaliseStreetName(value) {
  return cleanText(value)
    .replace(/\b(STREET|ST|ROAD|RD|AVENUE|AVE|DRIVE|DR|COURT|CT|CRESCENT|CRES|PLACE|PL|PARADE|PDE|TERRACE|TCE|BOULEVARD|BLVD|BVD|CIRCUIT|CCT|CLOSE|CL|LANE|LN|HIGHWAY|HWY|WAY)\b$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseStreetNumber(value) {
  const cleaned = cleanText(value);
  const match = cleaned.match(/\d+[A-Z]?(?:-\d+[A-Z]?)?/);
  return match ? match[0] : cleaned;
}

function splitStreetLine(addressLine1) {
  const cleaned = cleanText(addressLine1);
  const parts = cleaned.split(" ").filter(Boolean);

  let streetNumber = "";
  let streetType = "";
  let streetName = "";

  const numberIndex = parts.findIndex((part) => /\d/.test(part));
  if (numberIndex >= 0) streetNumber = normaliseStreetNumber(parts[numberIndex]);

  const lastPart = parts[parts.length - 1] || "";
  if (STREET_TYPE_MAP[lastPart]) {
    streetType = STREET_TYPE_MAP[lastPart];
    streetName = parts.slice(numberIndex + 1, -1).join(" ");
  } else {
    streetName = parts.slice(numberIndex + 1).join(" ");
  }

  return {
    streetNumber,
    streetName: normaliseStreetName(streetName),
    streetType
  };
}

function getAddressParts(address = {}) {
  const addressLine1 = address.addressLine1 || address.formattedAddress || "";
  const parsed = splitStreetLine(addressLine1);

  return {
    streetNumber: normaliseStreetNumber(address.houseNumber || address.housenumber || parsed.streetNumber),
    streetName: normaliseStreetName(address.street || parsed.streetName),
    streetType: normaliseStreetType(address.streetType || parsed.streetType),
    suburb: cleanText(address.suburb || address.city || address.town || address.village),
    postcode: cleanText(address.postcode),
    formattedAddress: address.formattedAddress || ""
  };
}

function recordValue(record, key) {
  return record?.[key] ?? record?.[key.replace(/ /g, " ")] ?? "";
}

function numberMatches(inputNumber, recordNumber) {
  const input = normaliseStreetNumber(inputNumber);
  const record = normaliseStreetNumber(recordNumber);
  if (!input || !record) return false;
  if (input === record) return true;

  const inputDigits = input.match(/\d+/)?.[0] || "";
  const recordDigits = record.match(/\d+/)?.[0] || "";
  return Boolean(inputDigits && recordDigits && inputDigits === recordDigits);
}

function scoreRecord(parts, record) {
  let score = 0;
  const recordStreetNumber = recordValue(record, "Street Number");
  const recordStreetName = recordValue(record, "Street Name");
  const recordStreetType = recordValue(record, "Street Type");
  const recordSuburb = recordValue(record, "Suburb");
  const recordPostcode = recordValue(record, "Post Code");

  if (parts.postcode && cleanText(recordPostcode) === parts.postcode) score += 25;
  if (parts.suburb && cleanText(recordSuburb) === parts.suburb) score += 25;
  if (parts.streetName && normaliseStreetName(recordStreetName) === parts.streetName) score += 30;
  if (parts.streetType && normaliseStreetType(recordStreetType) === parts.streetType) score += 10;
  if (numberMatches(parts.streetNumber, recordStreetNumber)) score += 40;

  return score;
}

function formatMatch(record) {
  const unitNumber = cleanText(recordValue(record, "Unit Number"));
  const streetNumber = cleanText(recordValue(record, "Street Number"));
  const streetName = cleanText(recordValue(record, "Street Name"));
  const streetType = cleanText(recordValue(record, "Street Type"));
  const suburb = cleanText(recordValue(record, "Suburb"));
  const postcode = cleanText(recordValue(record, "Post Code"));
  const unitPrefix = unitNumber ? `UNIT ${unitNumber}/` : "";

  return `${unitPrefix}${streetNumber} ${streetName} ${streetType}, ${suburb} ${postcode}`
    .replace(/\s+/g, " ")
    .trim();
}

async function queryPoolRegister(parts) {
  const filters = {};
  if (parts.postcode) filters["Post Code"] = parts.postcode;
  if (parts.suburb) filters.Suburb = parts.suburb;

  const params = new URLSearchParams({
    resource_id: RESOURCE_ID,
    limit: "100",
    filters: JSON.stringify(filters)
  });

  const response = await fetch(`${DATASTORE_SEARCH_URL}?${params.toString()}`, {
    headers: { "Accept": "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Queensland Open Data request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  if (!data?.success) throw new Error("Queensland Open Data response was not successful");
  return data.result?.records || [];
}

exports.poolRegisterLookup = functions
  .region("australia-southeast1")
  .runWith({ timeoutSeconds: 20, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(req, res);

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ registered: false, error: "Method not allowed" });
      return;
    }

    try {
      const address = req.body?.address || {};
      const parts = getAddressParts(address);

      if (!parts.postcode || !parts.suburb || !parts.streetName) {
        res.status(400).json({
          registered: false,
          status: "insufficient_address",
          reason: "The selected address did not include enough searchable address details.",
          addressParts: parts
        });
        return;
      }

      const records = await queryPoolRegister(parts);
      const scored = records
        .map((record) => ({ record, score: scoreRecord(parts, record) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0] || null;
      const registered = Boolean(best && best.score >= 80);

      if (!registered) {
        res.status(200).json({
          registered: false,
          status: "not_found",
          reason: "No matching registered pool was found for the selected address.",
          addressParts: parts,
          checkedRecordCount: records.length,
          bestScore: best?.score || 0
        });
        return;
      }

      const record = best.record;
      res.status(200).json({
        registered: true,
        status: "registered",
        matchConfidence: best.score,
        matchedAddress: formatMatch(record),
        siteName: recordValue(record, "Site Name") || "",
        unitNumber: recordValue(record, "Unit Number") || "",
        streetNumber: recordValue(record, "Street Number") || "",
        streetName: recordValue(record, "Street Name") || "",
        streetType: recordValue(record, "Street Type") || "",
        suburb: recordValue(record, "Suburb") || "",
        postcode: recordValue(record, "Post Code") || "",
        numberOfPools: recordValue(record, "Number of Pools") || "",
        localGovernmentArea: recordValue(record, "Local Government Authority Area") || "",
        sharedPoolProperty: recordValue(record, "Shared Pool Property") || "",
        source: "Queensland Government Open Data Pool safety register"
      });
    } catch (error) {
      console.error("Pool register lookup failed", error);
      res.status(500).json({
        registered: false,
        status: "lookup_unavailable",
        reason: "Pool register lookup could not be completed.",
        error: error.message
      });
    }
  });
