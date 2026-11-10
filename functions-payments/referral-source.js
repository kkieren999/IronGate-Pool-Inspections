const SOURCES = new Set([
  "Google / Google Maps", "Facebook", "Instagram", "Word of mouth",
  "Real estate agent / property manager", "Other", "Prefer not to say"
]);

function normaliseReferralSource(value) {
  return SOURCES.has(value) ? value : "";
}

module.exports = { normaliseReferralSource };
