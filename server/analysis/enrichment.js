function countTruthyObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value).filter((v) => {
    if (v === null || v === undefined || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }).length;
}

export function enrichScannerPayload({ infraRaw, buildRaw, buyerRaw, riskRaw, competitorsRaw, targetUrl }) {
  const pricingPlans = Array.isArray(buyerRaw?.pricing?.plans) ? buyerRaw.pricing.plans : [];
  const detectedFeatures = Array.isArray(buildRaw?.features?.detected) ? buildRaw.features.detected : [];
  const trackers = Array.isArray(riskRaw?.trackers) ? riskRaw.trackers : [];
  const competitors = Array.isArray(competitorsRaw?.competitors) ? competitorsRaw.competitors : [];

  return {
    targetUrl,
    infra: {
      techSignalCount: countTruthyObject(infraRaw?.techStack),
      trafficSignalCount: countTruthyObject(infraRaw?.traffic),
      thirdPartyCount: Array.isArray(infraRaw?.thirdParty) ? infraRaw.thirdParty.length : 0,
      headcountSignals: countTruthyObject(infraRaw?.headcount),
      trafficConfidence: infraRaw?.traffic?.confidence || null,
    },
    build: {
      detectedFeatureCount: detectedFeatures.length,
      pricingPageFeatureCount: Array.isArray(buildRaw?.features?.pricingPageFeatures)
        ? buildRaw.features.pricingPageFeatures.length
        : 0,
      openSourceCount: Array.isArray(buildRaw?.openSource) ? buildRaw.openSource.length : 0,
      hiringSignalCount: countTruthyObject(buildRaw?.hiring),
    },
    buyer: {
      pricingPlanCount: pricingPlans.length,
      finePrintCount: Array.isArray(buyerRaw?.pricing?.finePrint) ? buyerRaw.pricing.finePrint.length : 0,
      reviewSignalCount:
        (Array.isArray(buyerRaw?.reviewInsights?.g2) ? buyerRaw.reviewInsights.g2.length : 0) +
        (Array.isArray(buyerRaw?.reviewInsights?.reddit) ? buyerRaw.reviewInsights.reddit.length : 0),
      limitsCount: Array.isArray(buyerRaw?.limits) ? buyerRaw.limits.length : 0,
      competitorSignalCount: Array.isArray(buyerRaw?.competitors) ? buyerRaw.competitors.length : 0,
    },
    risk: {
      securityHeaderSignals: countTruthyObject(riskRaw?.securityHeaders),
      complianceBadgeCount: Array.isArray(riskRaw?.privacyCompliance?.complianceBadges)
        ? riskRaw.privacyCompliance.complianceBadges.length
        : 0,
      trackerCount: trackers.length,
      hasPrivacyPolicy: Boolean(riskRaw?.privacyCompliance?.privacyPolicyUrl),
    },
    competitors: {
      discoveredCount: competitors.length,
      namedCompetitors: competitors.map((c) => c?.name).filter(Boolean).slice(0, 8),
    },
  };
}
