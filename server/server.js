// ============================================================
// NAKEDSAAS BACKEND — Strip Any SaaS to Its True Cost
// Three pillars: Infra cost, Build cost, Buyer cost
// ============================================================

import express from "express";
import cors from "cors";
import { TinyFishWebAgentClient } from "./tinyfish/tinyfish-web-agent-client.js";
import { InfraCostScanner } from "./services/infra-cost-scanner.js";
import { BuildCostEstimator } from "./services/build-cost-estimator.js";
import { BuyerCostAnalyzer } from "./services/buyer-cost-analyzer.js";
import { CostModeler } from "./analysis/cost-modeler.js";
import { config, getMissingRuntimeEnv } from "./config/index.js";

const STREAM_TIMEOUT_MS = 120000; // 2 min — keep under Vercel/server limits
const HEARTBEAT_INTERVAL_MS = 25000; // send progress every 25s
const MAX_URL_LENGTH = 2048;

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
const configuredOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedProdOrigins = new Set([...configuredOrigins, vercelUrl].filter(Boolean));

const corsOrigin = (origin, callback) => {
  // Allow non-browser clients and same-origin requests with no Origin header.
  if (!origin) {
    callback(null, true);
    return;
  }

  if (!isProduction) {
    // In dev, allow any localhost origin so fallback ports (3001, 3002...) work.
    callback(null, /^https?:\/\/localhost(:\d+)?$/.test(origin));
    return;
  }

  // In production, allow configured origins and the current Vercel deployment URL.
  if (allowedProdOrigins.size === 0) {
    callback(null, true);
    return;
  }
  callback(null, allowedProdOrigins.has(origin));
};

app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_, res) => {
  const missingEnv = getMissingRuntimeEnv();
  res.json({
    status: "ok",
    engine: "tinyfish",
    version: "1.0.0",
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

async function runInvestigation({ targetUrl, domain, onProgress }) {
  const name = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
  const tinyfish = new TinyFishWebAgentClient(config.tinyfish);
  const emit = onProgress || (() => {});
  const scannerErrors = { infra: null, build: null, buyer: null };
  const fastOpt = { fast: config.fastMode };

  const runScanner = async (key, scannerPromiseFactory, fallback) => {
    try {
      return await scannerPromiseFactory();
    } catch (error) {
      scannerErrors[key] = error?.message || `Failed ${key} scanner`;
      console.error(`[NakedSaaS] ${key} scanner failed:`, error);
      return fallback;
    }
  };

  emit({ step: "init", message: "Initializing TinyFish engine...", progress: 5, platformsScanned: config.platformsScanned });

  // Run all three pillars in parallel to stay under time limit
  const partial = { infra: null, build: null, buyer: null };
  const infraP = runScanner(
    "infra",
    () => new InfraCostScanner(tinyfish).scan(targetUrl, fastOpt),
    {}
  ).then((r) => {
    partial.infra = r;
    return r;
  });
  const buildP = runScanner(
    "build",
    () => new BuildCostEstimator(tinyfish).scan(targetUrl, fastOpt),
    { features: [], openSource: [], hiring: null }
  ).then((r) => {
    partial.build = r;
    return r;
  });
  const buyerP = runScanner(
    "buyer",
    () => new BuyerCostAnalyzer(tinyfish).scan(targetUrl, fastOpt),
    { pricing: null, reviewInsights: [], limits: [], competitors: [] }
  ).then((r) => {
    partial.buyer = r;
    return r;
  });

  const timeoutMs = config.investigationTimeoutMs || 100000;
  const timeoutP = new Promise((_, rej) =>
    setTimeout(() => rej({ _timeout: true }), timeoutMs)
  );

  let timedOut = false;
  try {
    await Promise.race([
      Promise.allSettled([infraP, buildP, buyerP]),
      timeoutP,
    ]);
  } catch (e) {
    if (e?._timeout) {
      timedOut = true;
      console.warn("[NakedSaaS] Investigation timeout; using partial results.");
    } else {
      throw e;
    }
  }

  const infraRaw = partial.infra ?? {};
  const buildRaw = partial.build ?? { features: [], openSource: [], hiring: null };
  const buyerRaw = partial.buyer ?? { pricing: null, reviewInsights: [], limits: [], competitors: [] };

  emit({ step: "infra_done", message: "Infrastructure analysis complete", progress: 40 });
  emit({ step: "build_done", message: "Build cost estimation complete", progress: 65 });
  emit({ step: "buyer_done", message: "Buyer cost analysis complete", progress: 85 });
  emit({ step: "ai", message: "AI synthesizing cost intelligence report...", progress: 90 });

  let report;
  try {
    const modeler = new CostModeler(config.openai);
    report = await modeler.analyze(infraRaw, buildRaw, buyerRaw, { name, url: domain });
  } catch (error) {
    console.error("[NakedSaaS] Cost modeler failed:", error);
    throw new Error(error?.message || "AI report synthesis failed");
  }

  emit({ step: "complete", message: "Investigation complete", progress: 100 });
  const failedPillars = Object.entries(scannerErrors).filter(([, v]) => Boolean(v)).map(([k]) => k);
  if (timedOut) {
    failedPillars.push("timeout");
  }
  const modelErrors = report?.quality?.modelErrors || {};
  const degradedByModel = Object.entries(modelErrors).filter(([, v]) => Boolean(v)).map(([k]) => k);
  const degradedPillars = [...new Set([...failedPillars, ...degradedByModel])];

  return {
    target: { name, url: domain, logo: name[0] },
    scannedAt: new Date().toISOString(),
    platformsScanned: config.platformsScanned,
    ...report,
    quality: {
      partialData: degradedPillars.length > 0,
      degradedPillars,
      scannerErrors: timedOut ? { ...scannerErrors, timeout: "Investigation time limit reached; partial report." } : scannerErrors,
      modelErrors,
      completenessScore: Math.max(0, Math.round(((3 - degradedPillars.length) / 3) * 100)),
    },
  };
}

function sendStructuredError(res, error) {
  const status = error.statusCode || 500;
  const body = { error: error.message };
  if (error.missingEnv) body.missingEnv = error.missingEnv;
  res.status(status).json(body);
}

// ---- Async investigation (TinyFish run-async + poll). Stays under Vercel limits. ----
function getFastAsyncGoals(targetUrl, domain) {
  const name = domain.split(".")[0];
  return {
    infra: {
      url: targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`,
      goal: [
        `Analyze ${domain} and infer infrastructure + traffic signals in one pass.`,
        'Return strict JSON only: { "techStack": { "signals": {}, "cloudProvider": {}, "framework": "string", "cdn": "string" }, "traffic": { "cloudflareRadar": {}, "similarWeb": {}, "confidence": "high|medium|low", "notes": [] } }',
        "Be concise. If uncertain, use conservative values.",
      ].join(" "),
    },
    build: {
      url: targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`,
      goal: [
        "Analyze the product site and return detected build-relevant features.",
        'Output strict JSON only: { "detected": [{ "name": "string", "complexity": "extreme|hard|medium", "evidence": "string" }], "pricingPageFeatures": ["string"] }',
      ].join(" "),
    },
    buyer: {
      url: targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`,
      goal: [
        "Find and extract pricing page details including plan cards and fine print.",
        'Return strict JSON only: { "plans": [{ "name": "string", "price": "string", "features": ["string"], "limits": ["string"] }], "finePrint": ["string"] }',
      ].join(" "),
    },
  };
}

function coerceRunResultToInfra(result) {
  if (!result || typeof result !== "object") return { techStack: null, traffic: null, thirdParty: null, headcount: null };
  const t = result.techStack ?? result;
  const tr = result.traffic ?? null;
  return { techStack: t && typeof t === "object" ? t : null, traffic: tr && typeof tr === "object" ? tr : null, thirdParty: null, headcount: null };
}

function coerceRunResultToBuild(result) {
  if (!result || typeof result !== "object") return { features: { detected: [], pricingPageFeatures: [] }, openSource: [], hiring: null };
  return {
    features: {
      detected: Array.isArray(result.detected) ? result.detected : [],
      pricingPageFeatures: Array.isArray(result.pricingPageFeatures) ? result.pricingPageFeatures : [],
    },
    openSource: [],
    hiring: null,
  };
}

function coerceRunResultToBuyer(result) {
  if (!result || typeof result !== "object") return { pricing: null, reviewInsights: [], limits: [], competitors: [] };
  const p = result.plans;
  return {
    pricing: result.plans !== undefined ? { plans: Array.isArray(p) ? p : [], finePrint: result.finePrint || [] } : null,
    reviewInsights: [],
    limits: [],
    competitors: [],
  };
}

app.post("/api/investigate/async", async (req, res) => {
  try {
    assertRuntimeEnvReady();
    const { targetUrl, domain } = normalizeTargetUrl(req.body?.url);
    const name = domain.split(".")[0].charAt(0).toUpperCase() + domain.split(".")[0].slice(1);
    const goals = getFastAsyncGoals(targetUrl, domain);
    const tinyfish = new TinyFishWebAgentClient(config.tinyfish);

    const [infraRes, buildRes, buyerRes] = await Promise.all([
      tinyfish.runAsync(goals.infra),
      tinyfish.runAsync(goals.build),
      tinyfish.runAsync(goals.buyer),
    ]);

    const runIds = {
      infra: infraRes?.run_id ?? null,
      build: buildRes?.run_id ?? null,
      buyer: buyerRes?.run_id ?? null,
    };
    if (infraRes?.error?.message) runIds._infraError = infraRes.error.message;
    if (buildRes?.error?.message) runIds._buildError = buildRes.error.message;
    if (buyerRes?.error?.message) runIds._buyerError = buyerRes.error.message;

    res.json({ runIds, domain, name });
  } catch (error) {
    console.error("[NakedSaaS] Async start error:", error);
    sendStructuredError(res, error);
  }
});

app.post("/api/investigate/async/poll", async (req, res) => {
  try {
    assertRuntimeEnvReady();
    const { runIds, domain, name } = req.body || {};
    if (!runIds || !domain || !name) {
      return res.status(400).json({ error: "runIds, domain, and name are required." });
    }
    const tinyfish = new TinyFishWebAgentClient(config.tinyfish);

    const [infraRun, buildRun, buyerRun] = await Promise.all([
      runIds.infra ? tinyfish.getRun(runIds.infra) : null,
      runIds.build ? tinyfish.getRun(runIds.build) : null,
      runIds.buyer ? tinyfish.getRun(runIds.buyer) : null,
    ]);

    const statuses = {
      infra: infraRun?.status ?? "FAILED",
      build: buildRun?.status ?? "FAILED",
      buyer: buyerRun?.status ?? "FAILED",
    };
    const running = ["PENDING", "RUNNING"].some((s) => Object.values(statuses).includes(s));
    if (running) {
      return res.json({ status: "running", runs: statuses });
    }

    const infraRaw = coerceRunResultToInfra(infraRun?.result);
    const buildRaw = coerceRunResultToBuild(buildRun?.result);
    const buyerRaw = coerceRunResultToBuyer(buyerRun?.result);

    const modeler = new CostModeler(config.openai);
    const report = await modeler.analyze(infraRaw, buildRaw, buyerRaw, { name, url: domain });

    const scannerErrors = {
      infra: infraRun?.status === "COMPLETED" ? null : infraRun?.error?.message ?? "Run failed",
      build: buildRun?.status === "COMPLETED" ? null : buildRun?.error?.message ?? "Run failed",
      buyer: buyerRun?.status === "COMPLETED" ? null : buyerRun?.error?.message ?? "Run failed",
    };
    const failedPillars = Object.entries(scannerErrors).filter(([, v]) => Boolean(v)).map(([k]) => k);
    const modelErrors = report?.quality?.modelErrors || {};
    const degradedPillars = [...new Set([...failedPillars, ...Object.entries(modelErrors).filter(([, v]) => Boolean(v)).map(([k]) => k)])];

    res.json({
      status: "complete",
      report: {
        target: { name, url: domain, logo: name[0] },
        scannedAt: new Date().toISOString(),
        platformsScanned: config.platformsScanned,
        ...report,
        quality: {
          partialData: degradedPillars.length > 0,
          degradedPillars,
          scannerErrors,
          modelErrors,
          completenessScore: Math.max(0, Math.round(((3 - degradedPillars.length) / 3) * 100)),
        },
      },
    });
  } catch (error) {
    console.error("[NakedSaaS] Async poll error:", error);
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
    console.error("[NakedSaaS] Error:", error);
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

  let lastProgress = { message: "Starting...", progress: 0, platformsScanned: config.platformsScanned };
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
    console.error("[NakedSaaS] Stream error:", error);
    sendErrorAndEnd(error);
  } finally {
    clearInterval(heartbeatId);
  }
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
    const server = app.listen(port, () => {
      console.log(`[NakedSaaS] Running on http://localhost:${port}`);
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`[NakedSaaS] Port ${port} in use, trying ${port + 1}...`);
        tryListen(port + 1);
      } else {
        throw err;
      }
    });
  }
  tryListen(PORT);
}

export default app;
