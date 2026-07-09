import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { TinyFishEngine } from "./tinyfish/engine.js";
import {
  ASYNC_PILLAR_ORDER,
} from "./tinyfish/goals.js";
import { InfraCostScanner } from "./services/infra-cost-scanner.js";
import { BuildCostEstimator } from "./services/build-cost-estimator.js";
import { BuyerCostAnalyzer } from "./services/buyer-cost-analyzer.js";
import { TechRiskScanner } from "./services/tech-risk-scanner.js";
import { CompetitorScanner } from "./services/competitor-scanner.js";
import { CostModeler } from "./analysis/cost-modeler.js";
import { enrichScannerPayload } from "./analysis/enrichment.js";
import { buildInvestigationReport } from "./analysis/report-builder.js";
import { config, getExpectedSources, getExpectedTasks, getMissingRuntimeEnv } from "./config/index.js";
import { companyNameFromDomain } from "./utils/domain.js";
import { normalizePillarMeta } from "./utils/pillar-meta.js";

const STREAM_TIMEOUT_MS = config.streamTimeoutMs;
const HEARTBEAT_INTERVAL_MS = config.heartbeatIntervalMs;
const MAX_URL_LENGTH = 2048;

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const configuredOrigins = config.corsOrigins;
function getAllowedProdOrigins() {
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  return new Set([...configuredOrigins, vercelUrl].filter(Boolean));
}

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isProduction ? 120 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please retry in a minute." },
});

function corsDeniedError(origin) {
  const err = new Error(`Origin not allowed by CORS${origin ? `: ${origin}` : ""}`);
  err.statusCode = 403;
  return err;
}

const corsOrigin = (origin, callback) => {
  // Allow non-browser clients and same-origin requests with no Origin header.
  if (!origin) {
    callback(null, true);
    return;
  }

  if (!isProduction) {
    callback(null, /^https?:\/\/localhost(:\d+)?$/.test(origin));
    return;
  }

  // In production, allow configured origins and the current Vercel deployment URL.
  const isVercelDeployment = Boolean(process.env.VERCEL);
  if (isVercelDeployment && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
    callback(null, true);
    return;
  }

  const allowedProdOrigins = getAllowedProdOrigins();
  if (allowedProdOrigins.size === 0) {
    callback(corsDeniedError(origin));
    return;
  }
  if (!allowedProdOrigins.has(origin)) {
    callback(corsDeniedError(origin));
    return;
  }
  callback(null, true);
};

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "256kb" }));
app.use("/api", apiRateLimiter);

app.get("/api/health", (_, res) => {
  const missingEnv = getMissingRuntimeEnv();
  res.json({
    status: "ok",
    engine: "tinyfish",
    version: "1.0.0",
    tinyfish: {
      asyncStrategy: config.tinyfish.asyncStrategy,
      features: ["agent", "search", "fetch", "batch", "structured-output", "sse"],
    },
    envReady: missingEnv.length === 0,
    missingEnv,
  });
});

function normalizeTargetUrl(input) {
  if (!input || typeof input !== "string") {
    const err = new Error("URL required");
    err.statusCode = 400;
    throw err;
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    const err = new Error("URL too long");
    err.statusCode = 400;
    throw err;
  }
  try {
    const targetUrl = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      const err = new Error("Invalid URL format");
      err.statusCode = 400;
      throw err;
    }
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      const err = new Error("Invalid URL format");
      err.statusCode = 400;
      throw err;
    }
    return { targetUrl, domain: parsed.hostname };
  } catch (e) {
    if (e.statusCode === 400) throw e;
    const err = new Error("Invalid URL format");
    err.statusCode = 400;
    throw err;
  }
}

function assertRuntimeEnvReady() {
  const missingEnv = getMissingRuntimeEnv();
  if (missingEnv.length > 0) {
    const err = new Error(`Missing required environment variables: ${missingEnv.join(", ")}`);
    err.statusCode = 400;
    err.missingEnv = missingEnv;
    throw err;
  }
}

function assertValidAsyncPollPayload(body) {
  const { runIds, domain, name } = body || {};
  if (!runIds || typeof runIds !== "object" || Array.isArray(runIds)) {
    const err = new Error("runIds must be an object.");
    err.statusCode = 400;
    throw err;
  }
  if (typeof domain !== "string" || !domain.includes(".") || domain.length > 255) {
    const err = new Error("domain must be a valid hostname.");
    err.statusCode = 400;
    throw err;
  }
  if (typeof name !== "string" || name.trim().length < 1 || name.length > 100) {
    const err = new Error("name must be a non-empty string.");
    err.statusCode = 400;
    throw err;
  }
  const keys = ["infra", "build", "buyer", "risk", "competitors"];
  for (const key of keys) {
    const id = runIds[key];
    if (id !== undefined && id !== null && typeof id !== "string") {
      const err = new Error(`runIds.${key} must be a string when provided.`);
      err.statusCode = 400;
      throw err;
    }
  }
}

function freshnessBucket(extractedAt) {
  const ts = Date.parse(extractedAt || "");
  if (!Number.isFinite(ts)) return "unknown";
  const ageHours = Math.max(0, (Date.now() - ts) / (1000 * 60 * 60));
  if (ageHours <= config.quality.freshnessFreshHours) return "fresh";
  if (ageHours <= config.quality.freshnessStaleHours) return "stale";
  return "old";
}

function buildQualityMeta({ scannerErrors, modelErrors, modelWarnings, anomalies, pillarMeta, timedOut, fastMode }) {
  const perPillar = {};
  const sourceCoverage = {};
  const dataFreshness = {};
  const pillarCoverage = {};
  const confidenceScore = {};
  const pillars = ["infra", "build", "buyer", "risk", "competitors"];
  for (const pillar of pillars) {
    const meta = pillarMeta[pillar] || normalizePillarMeta(null, pillar);
    const uniqueFamilies = Array.isArray(meta.sourceFamilies) ? [...new Set(meta.sourceFamilies.filter(Boolean))] : [];
    const expectedSources = getExpectedSources(pillar, fastMode);
    const expectedTasks = getExpectedTasks(pillar, fastMode);
    const safeSourceCount = Math.max(0, Math.min(expectedSources, Math.min(meta.sourceCount, uniqueFamilies.length || meta.sourceCount)));
    const scannerFailed = Boolean(scannerErrors?.[pillar]);
    const modelFailed = Boolean(modelErrors?.[pillar]);
    const warningCount = Array.isArray(modelWarnings?.[pillar]) ? modelWarnings[pillar].length : 0;
    const coverageScore = Math.round((safeSourceCount / expectedSources) * 100);
    const reliabilityScore = Math.max(
      0,
      100 -
        (scannerFailed ? config.quality.scannerFailPenalty : 0) -
        (modelFailed ? config.quality.modelFailPenalty : 0) -
        warningCount * config.quality.warningPenalty -
        (timedOut ? config.quality.timeoutPenalty : 0)
    );
    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(coverageScore * config.quality.coverageWeight + reliabilityScore * config.quality.reliabilityWeight)
      )
    );
    perPillar[pillar] = {
      score,
      level:
        score >= config.quality.highConfidenceThreshold
          ? "high"
          : score >= config.quality.mediumConfidenceThreshold
            ? "medium"
            : "low",
      scoreComponents: { coverageScore, reliabilityScore, warningCount, scannerFailed, modelFailed },
    };
    confidenceScore[pillar] = score;
    sourceCoverage[pillar] = {
      sourceFamilies: uniqueFamilies,
      sourceCount: safeSourceCount,
      expectedSources,
    };
    dataFreshness[pillar] = {
      extractedAt: meta.extractedAt,
      freshness: freshnessBucket(meta.extractedAt),
    };
    pillarCoverage[pillar] = {
      tasksSucceeded: scannerFailed ? 0 : expectedTasks,
      tasksExpected: expectedTasks,
    };
  }
  const global = Math.round(pillars.reduce((sum, p) => sum + (confidenceScore[p] || 0), 0) / pillars.length);
  confidenceScore.global = global;
  confidenceScore.level =
    global >= config.quality.highConfidenceThreshold
      ? "high"
      : global >= config.quality.mediumConfidenceThreshold
        ? "medium"
        : "low";
  const crossChecks = (Array.isArray(anomalies) ? anomalies : []).map((note, idx) => ({
    id: `anomaly_${idx + 1}`,
    status: "conflict",
    note,
  }));
  return {
    pillarCoverage,
    sourceCoverage,
    dataFreshness,
    crossChecks,
    confidenceScore,
    perPillar,
    partialThreshold: config.quality.partialDataThreshold,
  };
}

const PILLAR_PROGRESS = { infra: 15, build: 30, buyer: 50, risk: 65, competitors: 78 };
const PILLAR_LABELS = {
  infra: "TinyFish Agent · Infrastructure",
  build: "TinyFish Agent · Build surface",
  buyer: "TinyFish Agent · Buyer pricing",
  risk: "TinyFish Agent · Risk audit",
  competitors: "TinyFish Agent · Competitors",
};

function createTinyFishProgress(engine, emit) {
  const platforms = new Set(["Target site", "TinyFish Web Agent"]);
  return (pillar) => (event) => {
    const mapped = engine.mapTinyFishEvent(event);
    if (!mapped) return;
    if (mapped.kind === "streaming") platforms.add("TinyFish live browser");
    if (mapped.message) {
      emit({
        step: `${pillar}_${mapped.kind || "event"}`,
        pillar,
        message: mapped.message,
        progress: PILLAR_PROGRESS[pillar] ?? 20,
        platformsScanned: [...platforms],
        streamingUrl: mapped.streamingUrl || undefined,
      });
    }
  };
}

async function runInvestigation({ targetUrl, domain, onProgress }) {
  const name = companyNameFromDomain(domain);
  const engine = new TinyFishEngine(config.tinyfish);
  const emit = onProgress || (() => {});
  const scannerErrors = { infra: null, build: null, buyer: null, risk: null, competitors: null };
  const fastOpt = {
    fast: config.fastMode,
    onEvent: null,
  };

  const runScanner = async (key, scannerPromiseFactory, fallback) => {
    try {
      return await scannerPromiseFactory();
    } catch (error) {
      scannerErrors[key] = error?.message || `Failed ${key} scanner`;
      console.error(`[CostLens] ${key} scanner failed:`, error);
      return fallback;
    }
  };

  emit({
    step: "init",
    message: "Initializing TinyFish engine (Agent + Search + Fetch)...",
    progress: 5,
    platformsScanned: ["Target site", "TinyFish Web Agent"],
  });

  const partial = { infra: null, build: null, buyer: null, risk: null, competitors: null };
  const infraP = runScanner(
    "infra",
    () => {
      fastOpt.onEvent = createTinyFishProgress(engine, emit)("infra");
      return new InfraCostScanner(engine).scan(targetUrl, fastOpt);
    },
    {}
  ).then((r) => {
    partial.infra = r;
    emit({ step: "infra_active", message: PILLAR_LABELS.infra, progress: PILLAR_PROGRESS.infra, platformsScanned: ["Target site", "TinyFish Fetch API", PILLAR_LABELS.infra] });
    return r;
  });
  const buildP = runScanner(
    "build",
    () => {
      fastOpt.onEvent = createTinyFishProgress(engine, emit)("build");
      return new BuildCostEstimator(engine).scan(targetUrl, fastOpt);
    },
    { features: [], openSource: [], hiring: null }
  ).then((r) => {
    partial.build = r;
    emit({ step: "build_active", message: PILLAR_LABELS.build, progress: PILLAR_PROGRESS.build, platformsScanned: ["Target site", "TinyFish Fetch API", PILLAR_LABELS.build] });
    return r;
  });
  const buyerP = runScanner(
    "buyer",
    () => {
      fastOpt.onEvent = createTinyFishProgress(engine, emit)("buyer");
      return new BuyerCostAnalyzer(engine).scan(targetUrl, fastOpt);
    },
    { pricing: null, reviewInsights: [], limits: [], competitors: [] }
  ).then((r) => {
    partial.buyer = r;
    emit({ step: "buyer_active", message: PILLAR_LABELS.buyer, progress: PILLAR_PROGRESS.buyer, platformsScanned: ["Target site", "TinyFish Fetch API", "TinyFish Search API", PILLAR_LABELS.buyer] });
    return r;
  });
  const riskP = runScanner(
    "risk",
    () => {
      fastOpt.onEvent = createTinyFishProgress(engine, emit)("risk");
      return new TechRiskScanner(engine).scan(targetUrl, fastOpt);
    },
    { securityHeaders: null, privacyCompliance: null, trackers: [] }
  ).then((r) => {
    partial.risk = r;
    emit({ step: "risk_active", message: PILLAR_LABELS.risk, progress: PILLAR_PROGRESS.risk, platformsScanned: ["Target site", "TinyFish Fetch API", PILLAR_LABELS.risk] });
    return r;
  });
  const competitorsP = runScanner(
    "competitors",
    () => {
      fastOpt.onEvent = createTinyFishProgress(engine, emit)("competitors");
      return new CompetitorScanner(engine).scan(targetUrl, domain, fastOpt);
    },
    { competitors: [], _meta: normalizePillarMeta(null, "competitors") }
  ).then((r) => {
    partial.competitors = r;
    emit({
      step: "competitors_active",
      message: PILLAR_LABELS.competitors,
      progress: PILLAR_PROGRESS.competitors,
      platformsScanned: ["TinyFish Search API", PILLAR_LABELS.competitors],
    });
    return r;
  });

  const timeoutMs = config.investigationTimeoutMs;
  const timeoutP = new Promise((_, rej) => setTimeout(() => rej({ _timeout: true }), timeoutMs));

  let timedOut = false;
  try {
    await Promise.race([Promise.allSettled([infraP, buildP, buyerP, riskP, competitorsP]), timeoutP]);
  } catch (e) {
    if (e?._timeout) {
      timedOut = true;
      console.warn("[CostLens] Investigation timeout; using partial results.");
    } else {
      throw e;
    }
  }

  const infraRaw = partial.infra ?? {};
  const buildRaw = partial.build ?? { features: [], openSource: [], hiring: null };
  const buyerRaw = partial.buyer ?? { pricing: null, reviewInsights: [], limits: [], competitors: [] };
  const riskRaw = partial.risk ?? { securityHeaders: null, privacyCompliance: null, trackers: [] };
  const competitorsRaw = partial.competitors ?? { competitors: [], _meta: normalizePillarMeta(null, "competitors") };
  const enrichment = enrichScannerPayload({
    infraRaw,
    buildRaw,
    buyerRaw,
    riskRaw,
    competitorsRaw,
    targetUrl,
  });

  emit({ step: "infra_done", message: "Infrastructure analysis complete", progress: 35 });
  emit({ step: "build_done", message: "Build cost estimation complete", progress: 55 });
  emit({ step: "buyer_done", message: "Buyer cost analysis complete", progress: 70 });
  emit({ step: "risk_done", message: "Risk scan complete", progress: 80 });
  emit({ step: "ai", message: "AI synthesizing cost intelligence report...", progress: 85 });

  const openaiConfig = {
    ...config.openai,
    quality: config.quality,
    bounds: config.analysis.bounds,
  };
  const modeler = new CostModeler(openaiConfig);
  let report;
  try {
    report = await modeler.analyze(infraRaw, buildRaw, buyerRaw, { name, url: domain }, enrichment);
  } catch (error) {
    console.error("[CostLens] Cost modeler failed:", error);
    throw new Error(error?.message || "AI report synthesis failed");
  }

  emit({ step: "ai_extra", message: "Generating executive summary and risk analysis...", progress: 92 });

  const targetInfo = { name, url: domain };
  const [execSummaryRes, negotiationRes, riskProfileRes, competitorAnalysisRes] = await Promise.allSettled([
    modeler.generateExecutiveSummary(report.infraCost, report.buildCost, report.buyerCost, targetInfo),
    modeler.generateNegotiationPlaybook(report.infraCost, report.buyerCost, targetInfo),
    modeler.analyzeRiskProfile(riskRaw, targetInfo, enrichment),
    modeler.generateCompetitorAnalysis(competitorsRaw, report.buyerCost, targetInfo),
  ]);

  const executiveSummary = execSummaryRes.status === "fulfilled" ? execSummaryRes.value : null;
  const negotiation = negotiationRes.status === "fulfilled" ? negotiationRes.value : null;
  const riskProfile = riskProfileRes.status === "fulfilled" ? riskProfileRes.value : modeler.getDefaultRiskProfile();
  const competitorAnalysis = competitorAnalysisRes.status === "fulfilled" ? competitorAnalysisRes.value : null;

  emit({ step: "complete", message: "Investigation complete", progress: 100 });

  const pillarMeta = {
    infra: normalizePillarMeta(infraRaw, "infra"),
    build: normalizePillarMeta(buildRaw, "build"),
    buyer: normalizePillarMeta(buyerRaw, "buyer"),
    risk: normalizePillarMeta(riskRaw, "risk"),
    competitors: normalizePillarMeta(competitorsRaw, "competitors"),
  };
  const qualityMeta = buildQualityMeta({
    scannerErrors,
    modelErrors: report?.quality?.modelErrors || {},
    modelWarnings: report?.quality?.modelWarnings || {},
    anomalies: report?.quality?.anomalies || [],
    pillarMeta,
    timedOut,
    fastMode: Boolean(config.fastMode),
  });

  return buildInvestigationReport({
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
    timedOut,
    fastMode: Boolean(config.fastMode),
  });
}

function sendStructuredError(res, error) {
  const status = error.statusCode || 500;
  const body = { error: error.message };
  if (error.missingEnv) body.missingEnv = error.missingEnv;
  res.status(status).json(body);
}

// ---- Async investigation ----
function coerceRunResultToInfra(result) {
  if (!result || typeof result !== "object") {
    return { techStack: null, traffic: null, thirdParty: null, headcount: null, _meta: normalizePillarMeta(null, "infra") };
  }
  const data = {
    techStack: result.techStack && typeof result.techStack === "object" ? result.techStack : null,
    traffic: result.traffic && typeof result.traffic === "object" ? result.traffic : null,
    thirdParty: Array.isArray(result.thirdParty) ? result.thirdParty : null,
    headcount: result.headcount && typeof result.headcount === "object" ? result.headcount : null,
  };
  const sourceFamilies = [];
  if (data.techStack) sourceFamilies.push("techStack");
  if (data.traffic) sourceFamilies.push("trafficSignals");
  if (Array.isArray(data.thirdParty) && data.thirdParty.length) sourceFamilies.push("thirdParty");
  if (data.headcount) sourceFamilies.push("headcount");
  return {
    ...data,
    _meta: normalizePillarMeta(
      { _meta: { pillar: "infra", extractedAt: new Date().toISOString(), sourceFamilies } },
      "infra"
    ),
  };
}

function coerceRunResultToBuild(result) {
  if (!result || typeof result !== "object") {
    return { features: { detected: [], pricingPageFeatures: [] }, openSource: [], hiring: null, _meta: normalizePillarMeta(null, "build") };
  }
  const data = {
    features: {
      detected: Array.isArray(result.detected) ? result.detected : [],
      pricingPageFeatures: Array.isArray(result.pricingPageFeatures) ? result.pricingPageFeatures : [],
    },
    openSource: Array.isArray(result.openSource) ? result.openSource : [],
    hiring: result.hiring && typeof result.hiring === "object" ? result.hiring : null,
  };
  const sourceFamilies = [];
  if (data.features.detected.length || data.features.pricingPageFeatures.length) sourceFamilies.push("features");
  if (data.openSource.length) sourceFamilies.push("openSource");
  if (data.hiring) sourceFamilies.push("hiringBenchmarks");
  return {
    ...data,
    _meta: normalizePillarMeta(
      { _meta: { pillar: "build", extractedAt: new Date().toISOString(), sourceFamilies } },
      "build"
    ),
  };
}

function coerceRunResultToBuyer(result) {
  if (!result || typeof result !== "object") {
    return { pricing: null, reviewInsights: [], limits: [], competitors: [], _meta: normalizePillarMeta(null, "buyer") };
  }
  const data = {
    pricing: result.plans !== undefined ? { plans: Array.isArray(result.plans) ? result.plans : [], finePrint: result.finePrint || [] } : null,
    reviewInsights: result.reviewInsights && typeof result.reviewInsights === "object" ? result.reviewInsights : [],
    limits: Array.isArray(result.limits) ? result.limits : [],
    competitors: Array.isArray(result.competitors) ? result.competitors : [],
  };
  const sourceFamilies = [];
  if (data.pricing?.plans?.length) sourceFamilies.push("pricing");
  if (data.pricing?.finePrint?.length) sourceFamilies.push("pricingFinePrint");
  if (
    (Array.isArray(data.reviewInsights?.g2) && data.reviewInsights.g2.length) ||
    (Array.isArray(data.reviewInsights?.reddit) && data.reviewInsights.reddit.length)
  ) {
    sourceFamilies.push("reviews");
  }
  if (data.limits.length) sourceFamilies.push("limitsDocs");
  if (data.competitors.length) sourceFamilies.push("competitors");
  return {
    ...data,
    _meta: normalizePillarMeta(
      { _meta: { pillar: "buyer", extractedAt: new Date().toISOString(), sourceFamilies } },
      "buyer"
    ),
  };
}

function coerceRunResultToRisk(result) {
  if (!result || typeof result !== "object") {
    return { securityHeaders: null, privacyCompliance: null, trackers: [], _meta: normalizePillarMeta(null, "risk") };
  }
  const data = {
    securityHeaders: result.securityHeaders && typeof result.securityHeaders === "object" ? result.securityHeaders : null,
    privacyCompliance: result.privacyCompliance && typeof result.privacyCompliance === "object" ? result.privacyCompliance : null,
    trackers: Array.isArray(result.trackers) ? result.trackers : [],
  };
  const sourceFamilies = [];
  if (data.securityHeaders) sourceFamilies.push("securityHeaders");
  if (data.privacyCompliance) sourceFamilies.push("privacyCompliance");
  if (data.trackers.length) sourceFamilies.push("trackers");
  return {
    ...data,
    _meta: normalizePillarMeta(
      { _meta: { pillar: "risk", extractedAt: new Date().toISOString(), sourceFamilies } },
      "risk"
    ),
  };
}

function coerceRunResultToCompetitors(result) {
  if (!result || typeof result !== "object") {
    return { competitors: [], _meta: normalizePillarMeta(null, "competitors") };
  }
  const competitors = Array.isArray(result.competitors) ? result.competitors : [];
  const filtered = competitors.filter((c) => c && typeof c === "object" && typeof c.name === "string" && c.name.trim());
  return {
    competitors: filtered,
    _meta: normalizePillarMeta(
      {
        _meta: {
          pillar: "competitors",
          extractedAt: new Date().toISOString(),
          sourceFamilies: filtered.length ? ["competitors"] : [],
        },
      },
      "competitors"
    ),
  };
}

app.post("/api/investigate/async", async (req, res) => {
  try {
    assertRuntimeEnvReady();
    const { targetUrl, domain } = normalizeTargetUrl(req.body?.url);
    const name = companyNameFromDomain(domain);
    const engine = new TinyFishEngine(config.tinyfish);
    const strategy = config.tinyfish.asyncStrategy;
    const runIds = {};

    if (strategy === "queue") {
      const queued = await engine.queueAllPillars(targetUrl, domain);
      if (queued.errors?.length) {
        console.warn("[CostLens] Async queue partial failures:", queued.errors);
      }
      for (const item of queued.runIds || []) {
        runIds[item.pillar] = item.run_id;
      }
      if (!runIds.infra && !runIds.build && !runIds.buyer && !runIds.risk) {
        return res.status(502).json({
          error: "Failed to queue async investigation runs.",
          errors: queued.errors,
          domain,
          name,
          strategy,
        });
      }
      return res.status(200).json({ runIds, domain, name, partial: false, strategy });
    }

    let batchRes;
    try {
      batchRes = await engine.runBatchAllPillars(targetUrl, domain);
    } catch (error) {
      return res.status(502).json({
        error: error?.message || "Failed to start batch investigation runs.",
        domain,
        name,
        strategy,
      });
    }

    if (batchRes?.error?.message) {
      return res.status(502).json({
        error: batchRes.error.message,
        domain,
        name,
        strategy,
      });
    }

    const runIdList = Array.isArray(batchRes?.run_ids) ? batchRes.run_ids : [];
    for (let i = 0; i < ASYNC_PILLAR_ORDER.length; i++) {
      runIds[ASYNC_PILLAR_ORDER[i]] = runIdList[i] ?? null;
    }

    if (!runIds.infra && !runIds.build && !runIds.buyer && !runIds.risk) {
      return res.status(502).json({ error: "Failed to start async investigation runs.", runIds, domain, name, strategy });
    }

    res.status(200).json({ runIds, domain, name, partial: false, strategy });
  } catch (error) {
    console.error("[CostLens] Async start error:", error);
    sendStructuredError(res, error);
  }
});

app.post("/api/investigate/async/poll", async (req, res) => {
  try {
    assertRuntimeEnvReady();
    assertValidAsyncPollPayload(req.body);
    const { runIds, domain, name } = req.body || {};
    const engine = new TinyFishEngine(config.tinyfish);

    const lookupIds = ASYNC_PILLAR_ORDER.map((pillar) => runIds[pillar]).filter(Boolean);
    let batchLookup = { data: [], not_found: [] };
    try {
      batchLookup = await engine.getRunsBatch(lookupIds);
    } catch (error) {
      console.error("[CostLens] Batch run lookup failed:", error);
    }

    const runById = new Map((batchLookup.data || []).map((run) => [run.run_id, run]));
    const missingRun = (pillar) => ({
      status: "FAILED",
      error: { message: runIds[pillar] ? "Run lookup failed" : "Missing run id" },
      result: null,
    });

    const infraRun = runIds.infra ? runById.get(runIds.infra) ?? missingRun("infra") : missingRun("infra");
    const buildRun = runIds.build ? runById.get(runIds.build) ?? missingRun("build") : missingRun("build");
    const buyerRun = runIds.buyer ? runById.get(runIds.buyer) ?? missingRun("buyer") : missingRun("buyer");
    const riskRun = runIds.risk ? runById.get(runIds.risk) ?? missingRun("risk") : missingRun("risk");
    const competitorsRun = runIds.competitors
      ? runById.get(runIds.competitors) ?? missingRun("competitors")
      : missingRun("competitors");

    const statuses = {
      infra: infraRun?.status ?? "FAILED",
      build: buildRun?.status ?? "FAILED",
      buyer: buyerRun?.status ?? "FAILED",
      risk: riskRun?.status ?? "FAILED",
      competitors: competitorsRun?.status ?? "FAILED",
    };
    const running = ["PENDING", "RUNNING"].some((s) => Object.values(statuses).includes(s));
    if (running) {
      return res.json({ status: "running", runs: statuses });
    }

    const infraRaw = coerceRunResultToInfra(infraRun?.result);
    const buildRaw = coerceRunResultToBuild(buildRun?.result);
    const buyerRaw = coerceRunResultToBuyer(buyerRun?.result);
    const riskRaw = coerceRunResultToRisk(riskRun?.result);
    const competitorsRaw = coerceRunResultToCompetitors(competitorsRun?.result);

    const enrichment = enrichScannerPayload({
      infraRaw,
      buildRaw,
      buyerRaw,
      riskRaw,
      competitorsRaw,
      targetUrl: `https://${domain}`,
    });

    const openaiConfig = {
      ...config.openai,
      quality: config.quality,
      bounds: config.analysis.bounds,
    };
    const modeler = new CostModeler(openaiConfig);
    const report = await modeler.analyze(infraRaw, buildRaw, buyerRaw, { name, url: domain }, enrichment);

    const targetInfo = { name, url: domain };
    const [execSummaryRes, negotiationRes, riskProfileRes, competitorAnalysisRes] = await Promise.allSettled([
      modeler.generateExecutiveSummary(report.infraCost, report.buildCost, report.buyerCost, targetInfo),
      modeler.generateNegotiationPlaybook(report.infraCost, report.buyerCost, targetInfo),
      modeler.analyzeRiskProfile(riskRaw, targetInfo, enrichment),
      modeler.generateCompetitorAnalysis(competitorsRaw, report.buyerCost, targetInfo),
    ]);
    const executiveSummary = execSummaryRes.status === "fulfilled" ? execSummaryRes.value : null;
    const negotiation = negotiationRes.status === "fulfilled" ? negotiationRes.value : null;
    const riskProfile = riskProfileRes.status === "fulfilled" ? riskProfileRes.value : modeler.getDefaultRiskProfile();
    const competitorAnalysis = competitorAnalysisRes.status === "fulfilled" ? competitorAnalysisRes.value : null;

    const scannerErrors = {
      infra: infraRun?.status === "COMPLETED" ? null : infraRun?.error?.message ?? "Run failed",
      build: buildRun?.status === "COMPLETED" ? null : buildRun?.error?.message ?? "Run failed",
      buyer: buyerRun?.status === "COMPLETED" ? null : buyerRun?.error?.message ?? "Run failed",
      risk: riskRun?.status === "COMPLETED" ? null : riskRun?.error?.message ?? "Run failed",
      competitors: competitorsRun?.status === "COMPLETED" ? null : competitorsRun?.error?.message ?? "Run failed",
    };
    const pillarMeta = {
      infra: normalizePillarMeta(infraRaw, "infra"),
      build: normalizePillarMeta(buildRaw, "build"),
      buyer: normalizePillarMeta(buyerRaw, "buyer"),
      risk: normalizePillarMeta(riskRaw, "risk"),
      competitors: normalizePillarMeta(competitorsRaw, "competitors"),
    };
    const qualityMeta = buildQualityMeta({
      scannerErrors,
      modelErrors: report?.quality?.modelErrors || {},
      modelWarnings: report?.quality?.modelWarnings || {},
      anomalies: report?.quality?.anomalies || [],
      pillarMeta,
      timedOut: false,
      fastMode: true,
    });

    res.json({
      status: "complete",
      report: buildInvestigationReport({
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
        timedOut: false,
        fastMode: true,
      }),
    });
  } catch (error) {
    console.error("[CostLens] Async poll error:", error);
    sendStructuredError(res, error);
  }
});

// Main scan endpoint
app.post("/api/investigate", async (req, res) => {
  try {
    assertRuntimeEnvReady();
    const { targetUrl, domain } = normalizeTargetUrl(req.body?.url);
    const report = await runInvestigation({ targetUrl, domain });
    res.json(report);
  } catch (error) {
    console.error("[CostLens] Error:", error);
    sendStructuredError(res, error);
  }
});

// SSE streaming endpoint
app.post("/api/investigate/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  req.setTimeout(STREAM_TIMEOUT_MS);
  res.setTimeout(STREAM_TIMEOUT_MS);

  let ended = false;
  const send = (event, data) => {
    if (ended) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (_) {}
  };

  const sendErrorAndEnd = (error) => {
    if (ended) return;
    ended = true;
    send("error", {
      message: error.message,
      ...(error.missingEnv ? { missingEnv: error.missingEnv } : {}),
    });
    try {
      res.end();
    } catch (_) {}
  };

  res.on("timeout", () => {
    sendErrorAndEnd(new Error("Investigation timed out on the server. Try again or use a shorter run."));
  });

  let lastProgress = { message: "Starting...", progress: 0, platformsScanned: ["Target site", "TinyFish Web Agent"] };
  const heartbeatId = setInterval(() => {
    send("progress", { ...lastProgress, message: lastProgress.message + " — still running" });
  }, HEARTBEAT_INTERVAL_MS);

  try {
    assertRuntimeEnvReady();
    const { targetUrl, domain } = normalizeTargetUrl(req.body?.url);
    const report = await runInvestigation({
      targetUrl,
      domain,
      onProgress: (payload) => {
        lastProgress = payload;
        send("progress", payload);
      },
    });
    if (!ended) {
      ended = true;
      send("result", report);
      try {
        res.end();
      } catch (_) {}
    }
  } catch (error) {
    console.error("[CostLens] Stream error:", error);
    sendErrorAndEnd(error);
  } finally {
    clearInterval(heartbeatId);
  }
});

app.use((error, _req, res, _next) => {
  const status = error?.statusCode || 500;
  const payload = {
    error: status >= 500 ? "Internal server error" : error.message || "Request failed",
  };
  const originHint = [...getAllowedProdOrigins()];
  if (status < 500 && originHint.length > 0 && error?.message?.includes("CORS")) {
    payload.allowedOrigins = originHint;
  }
  if (error?.missingEnv) payload.missingEnv = error.missingEnv;
  if (!res.headersSent) {
    res.status(status).json(payload);
  }
});

process.on("unhandledRejection", (reason) => {
  console.error("[CostLens] Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[CostLens] Uncaught exception:", error);
});

// Serve client: Vite dev middleware in dev, static files in production
if (!process.env.VERCEL) {
  const isDev = process.env.NODE_ENV !== "production";
  const PORT = config.port || 3000;

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const { default: path } = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.resolve(__dirname, "../dist");
    app.use(express.static(distPath));
    app.get("*", (_, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  function tryListen(port) {
    const numPort = Number(port);
    const server = app.listen(numPort, () => {
      console.log(`[CostLens] Running on http://localhost:${numPort}`);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[CostLens] Port ${numPort} in use, trying ${numPort + 1}...`);
        tryListen(numPort + 1);
      } else {
        throw err;
      }
    });
  }
  tryListen(PORT);
}

export default app;
export const __testUtils = {
  normalizePillarMeta,
  buildQualityMeta,
  freshnessBucket,
  assertValidAsyncPollPayload,
};
