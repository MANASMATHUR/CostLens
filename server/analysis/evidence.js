const SOURCE_LABELS = {
  techStack: "Target site tech stack",
  trafficSignals: "Traffic intelligence",
  thirdParty: "Third-party services",
  headcount: "Engineering headcount signals",
  features: "Product feature surface",
  openSource: "Open-source footprint",
  hiringBenchmarks: "Hiring compensation benchmarks",
  pricing: "Pricing page extraction",
  pricingFinePrint: "Pricing fine print",
  reviews: "Public review sentiment",
  limitsDocs: "Documentation limits",
  competitors: "Competitor signals",
  securityHeaders: "Security headers",
  privacyCompliance: "Privacy and compliance",
  trackers: "Third-party trackers",
  searchApi: "TinyFish Search API",
  fetchApi: "TinyFish Fetch API",
};

export function sourceFamiliesFromPillar(pillarData) {
  const families = pillarData?._meta?.sourceFamilies;
  return Array.isArray(families) ? [...new Set(families.filter(Boolean))] : [];
}

export function labelSourceFamily(key) {
  return SOURCE_LABELS[key] || key;
}

export function buildEvidenceContext(pillarData, targetUrl) {
  const families = sourceFamiliesFromPillar(pillarData);
  const extractedAt = pillarData?._meta?.extractedAt || null;
  return {
    targetUrl,
    extractedAt,
    sourceFamilies: families,
    sourceLabels: families.map(labelSourceFamily),
    sourceCount: families.length,
    hasEvidence: families.length > 0,
  };
}

export function collectPlatformsScanned(pillarMeta) {
  const labels = new Set(["Target site"]);
  for (const meta of Object.values(pillarMeta || {})) {
    for (const family of meta?.sourceFamilies || []) {
      labels.add(labelSourceFamily(family));
    }
  }
  return [...labels];
}

export function provenanceFromPillar(pillarData, modelEvidenceSources = []) {
  const scannerFamilies = sourceFamiliesFromPillar(pillarData);
  const modelFamilies = Array.isArray(modelEvidenceSources) ? modelEvidenceSources : [];
  const merged = [...new Set([...scannerFamilies, ...modelFamilies].filter(Boolean))];
  return {
    evidenceSources: merged,
    sourceLabels: merged.map(labelSourceFamily),
    extractedAt: pillarData?._meta?.extractedAt || new Date().toISOString(),
  };
}
