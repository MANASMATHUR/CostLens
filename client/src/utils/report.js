import { toNum, toText } from "./formatting";

export function normalizeReport(results) {
  const fallback = {
    target: { name: "Target", url: "unknown", logo: "?" },
    scannedAt: new Date().toISOString(),
    platformsScanned: [],
    infraCost: {
      monthlyEstimate: { low: 0, mid: 0, high: 0 },
      perUserEstimate: { low: 0, mid: 0, high: 0 },
      revenueEstimate: 0,
      grossMargin: { low: 0, mid: 0, high: 0 },
      breakdown: [],
      signals: [],
    },
    buildCost: {
      totalEstimate: { low: 0, mid: 0, high: 0 },
      timeEstimate: { low: 0, mid: 0, high: 0 },
      teamSize: { min: 0, optimal: 0, max: 0 },
      breakdown: [],
      techStack: [],
    },
    buyerCost: {
      plans: [],
      tcoComparison: [],
      competitorComparison: [],
    },
    quality: {
      partialData: false,
      degradedPillars: [],
      scannerErrors: { infra: null, build: null, buyer: null },
      modelErrors: { infra: null, build: null, buyer: null },
      completenessScore: 100,
    },
  };
  if (!results) return fallback;

  return {
    target: {
      name: toText(results?.target?.name, "Target"),
      url: toText(results?.target?.url, "unknown"),
      logo: toText(results?.target?.logo, "?"),
    },
    scannedAt: results?.scannedAt || fallback.scannedAt,
    platformsScanned: Array.isArray(results?.platformsScanned) ? results.platformsScanned : [],
    infraCost: {
      monthlyEstimate: {
        low: toNum(results?.infraCost?.monthlyEstimate?.low),
        mid: toNum(results?.infraCost?.monthlyEstimate?.mid),
        high: toNum(results?.infraCost?.monthlyEstimate?.high),
      },
      perUserEstimate: {
        low: toNum(results?.infraCost?.perUserEstimate?.low),
        mid: toNum(results?.infraCost?.perUserEstimate?.mid),
        high: toNum(results?.infraCost?.perUserEstimate?.high),
      },
      revenueEstimate: toNum(results?.infraCost?.revenueEstimate),
      grossMargin: {
        low: toNum(results?.infraCost?.grossMargin?.low),
        mid: toNum(results?.infraCost?.grossMargin?.mid),
        high: toNum(results?.infraCost?.grossMargin?.high),
      },
      breakdown: Array.isArray(results?.infraCost?.breakdown)
        ? results.infraCost.breakdown.map((item) => ({
            category: toText(item?.category, "Unknown category"),
            estimate: toText(item?.estimate, "Unknown"),
            confidence: toText(item?.confidence, "low"),
            evidence: toText(item?.evidence, "No evidence available."),
            pct: toNum(item?.pct),
          }))
        : [],
      signals: Array.isArray(results?.infraCost?.signals)
        ? results.infraCost.signals.map((item) => ({
            icon: toText(item?.icon, "•"),
            text: toText(item?.text, "No signal available"),
          }))
        : [],
    },
    buildCost: {
      totalEstimate: {
        low: toNum(results?.buildCost?.totalEstimate?.low),
        mid: toNum(results?.buildCost?.totalEstimate?.mid),
        high: toNum(results?.buildCost?.totalEstimate?.high),
      },
      timeEstimate: {
        low: toNum(results?.buildCost?.timeEstimate?.low),
        mid: toNum(results?.buildCost?.timeEstimate?.mid),
        high: toNum(results?.buildCost?.timeEstimate?.high),
      },
      teamSize: {
        min: toNum(results?.buildCost?.teamSize?.min),
        optimal: toNum(results?.buildCost?.teamSize?.optimal),
        max: toNum(results?.buildCost?.teamSize?.max),
      },
      breakdown: Array.isArray(results?.buildCost?.breakdown)
        ? results.buildCost.breakdown.map((item) => ({
            module: toText(item?.module, "Unknown module"),
            effort: toText(item?.effort, "Unknown"),
            cost: toText(item?.cost, "Unknown"),
            complexity: toText(item?.complexity, "medium"),
            notes: toText(item?.notes, "No implementation notes available."),
          }))
        : [],
      techStack: Array.isArray(results?.buildCost?.techStack)
        ? results.buildCost.techStack.map((item) => ({
            layer: toText(item?.layer, "Layer"),
            tech: toText(item?.tech, "Unknown"),
            detected: Boolean(item?.detected),
            confidence: toText(item?.confidence, "low"),
          }))
        : [],
    },
    buyerCost: {
      plans: Array.isArray(results?.buyerCost?.plans)
        ? results.buyerCost.plans.map((plan) => ({
            name: toText(plan?.name, "Unknown"),
            listed: toText(plan?.listed, "Unknown"),
            actualMonthly: toText(plan?.actualMonthly, "Unknown"),
            gotchas: Array.isArray(plan?.gotchas) ? plan.gotchas.map((g) => toText(g, "Unknown")) : [],
            hiddenCosts: Array.isArray(plan?.hiddenCosts)
              ? plan.hiddenCosts.map((hc) => ({
                  item: toText(hc?.item, "Unknown"),
                  cost: toText(hc?.cost, "Unknown"),
                  note: toText(hc?.note, "No note"),
                }))
              : [],
          }))
        : [],
      tcoComparison: Array.isArray(results?.buyerCost?.tcoComparison)
        ? results.buyerCost.tcoComparison.map((row) => ({
            scenario: toText(row?.scenario, "Unknown"),
            monthlyListed: toText(row?.monthlyListed, "Unknown"),
            monthlyActual: toText(row?.monthlyActual, "Unknown"),
            annualDelta: toText(row?.annualDelta, "Unknown"),
            note: toText(row?.note, "No note"),
          }))
        : [],
      competitorComparison: Array.isArray(results?.buyerCost?.competitorComparison)
        ? results.buyerCost.competitorComparison.map((row) => ({
            name: toText(row?.name, "Unknown"),
            cost: toText(row?.cost, "Unknown"),
            features: toText(row?.features, "N/A"),
          }))
        : [],
    },
    quality: {
      partialData: Boolean(results?.quality?.partialData),
      degradedPillars: Array.isArray(results?.quality?.degradedPillars) ? results.quality.degradedPillars : [],
      scannerErrors: {
        infra: results?.quality?.scannerErrors?.infra || null,
        build: results?.quality?.scannerErrors?.build || null,
        buyer: results?.quality?.scannerErrors?.buyer || null,
      },
      modelErrors: {
        infra: results?.quality?.modelErrors?.infra || null,
        build: results?.quality?.modelErrors?.build || null,
        buyer: results?.quality?.modelErrors?.buyer || null,
      },
      completenessScore: toNum(results?.quality?.completenessScore, 100),
    },
  };
}
