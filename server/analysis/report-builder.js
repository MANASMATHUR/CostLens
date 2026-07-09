import { collectPlatformsScanned, provenanceFromPillar } from "./evidence.js";
import { normalizePillarMeta } from "../utils/pillar-meta.js";

export function buildInvestigationReport({
  name,
  domain,
  report,
  infraRaw,
  buildRaw,
  buyerRaw,
  riskRaw,
  competitorsRaw,
  executiveSummary,
  negotiation,
  riskProfile,
  competitorAnalysis,
  scannerErrors,
  modeler,
  qualityMeta,
  timedOut = false,
  fastMode,
}) {
  const failedPillars = Object.entries(scannerErrors).filter(([, v]) => Boolean(v)).map(([k]) => k);
  if (timedOut) failedPillars.push("timeout");

  const modelErrors = report?.quality?.modelErrors || {};
  const modelWarnings = report?.quality?.modelWarnings || {};
  const anomalies = report?.quality?.anomalies || [];
  const degradedByModel = Object.entries(modelErrors).filter(([, v]) => Boolean(v)).map(([k]) => k);
  const degradedByWarnings = Object.entries(modelWarnings)
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k]) => k);
  const degradedPillars = [...new Set([...failedPillars, ...degradedByModel, ...degradedByWarnings])];

  const pillarMeta = {
    infra: normalizePillarMeta(infraRaw, "infra"),
    build: normalizePillarMeta(buildRaw, "build"),
    buyer: normalizePillarMeta(buyerRaw, "buyer"),
    risk: normalizePillarMeta(riskRaw, "risk"),
    competitors: normalizePillarMeta(competitorsRaw, "competitors"),
  };

  const totalPillars = 5;
  const legacyCompleteness = Math.max(
    0,
    Math.round(((totalPillars - Math.min(totalPillars, degradedPillars.length)) / totalPillars) * 100)
  );

  return {
    target: { name, url: domain, logo: name[0] },
    scannedAt: new Date().toISOString(),
    platformsScanned: collectPlatformsScanned(pillarMeta),
    ...report,
    executiveSummary: executiveSummary || null,
    negotiation: negotiation || null,
    riskProfile: riskProfile || modeler.getDefaultRiskProfile(),
    competitorAnalysis: competitorAnalysis || null,
    infraCost: {
      ...report.infraCost,
      confidence: {
        overall: qualityMeta.perPillar.infra.score,
        level: qualityMeta.perPillar.infra.level,
      },
    },
    buildCost: {
      ...report.buildCost,
      confidence: {
        overall: qualityMeta.perPillar.build.score,
        level: qualityMeta.perPillar.build.level,
      },
    },
    buyerCost: {
      ...report.buyerCost,
      confidence: {
        overall: qualityMeta.perPillar.buyer.score,
        level: qualityMeta.perPillar.buyer.level,
      },
    },
    provenance: {
      infra: provenanceFromPillar(infraRaw, report?.infraCost?.evidenceSources),
      build: provenanceFromPillar(buildRaw, report?.buildCost?.evidenceSources),
      buyer: provenanceFromPillar(buyerRaw, report?.buyerCost?.evidenceSources),
      risk: provenanceFromPillar(riskRaw, riskProfile?.evidenceSources),
      competitors: provenanceFromPillar(competitorsRaw, competitorAnalysis?.evidenceSources),
    },
    quality: {
      partialData:
        degradedPillars.length > 0 ||
        qualityMeta.confidenceScore.global < (qualityMeta.partialThreshold ?? 80),
      degradedPillars,
      scannerErrors: timedOut
        ? { ...scannerErrors, timeout: "Investigation time limit reached; partial report." }
        : scannerErrors,
      modelErrors,
      modelWarnings,
      anomalies,
      completenessScore: legacyCompleteness,
      qualityMeta: { ...qualityMeta, fastMode },
    },
  };
}
