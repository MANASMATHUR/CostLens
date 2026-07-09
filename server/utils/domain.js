const MULTI_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "co.nz", "com.br", "com.mx",
]);

export function parseTargetDomain(input) {
  const trimmed = String(input || "").trim();
  const targetUrl = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
  const parsed = new URL(targetUrl);
  return { targetUrl, domain: parsed.hostname };
}

export function registrableDomain(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  const lastThree = parts.slice(-3).join(".");
  if (MULTI_PART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  if (MULTI_PART_TLDS.has(lastThree)) return parts.slice(-4).join(".");
  return lastTwo;
}

export function companyNameFromDomain(hostname) {
  const base = registrableDomain(hostname).split(".")[0] || hostname;
  const cleaned = base.replace(/[-_]+/g, " ").trim();
  if (!cleaned) return "Unknown";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
