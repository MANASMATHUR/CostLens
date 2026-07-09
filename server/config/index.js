import "dotenv/config";

export const config = {
  port: Number(process.env.PORT) || 3000,
  corsOrigins: ["http://localhost:3000"],
  tinyfish: {
    endpoint: "https://agent.tinyfish.ai",
    apiKey: process.env.TINYFISH_API_KEY || "",
    browserProfile: "stealth",
    proxyEnabled: false,
    proxyCountryCode: "",
    retryAttempts: 2,
    requestTimeoutMs: 120000,
    sseTimeoutMs: 130000,
    asyncStrategy: "queue",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: "gpt-4o",
    summaryModel: "gpt-4o",
    temperature: 0.2,
    retries: 2,
    maxTokens: {
      infra: 2500,
      build: 3000,
      buyer: 2500,
      executive: 1800,
      negotiation: 1800,
      risk: 1800,
      competitors: 2200,
    },
  },
  investigationTimeoutMs: 60000,
  streamTimeoutMs: 120000,
  heartbeatIntervalMs: 25000,
  fastMode: true,
  quality: {
    freshnessFreshHours: 6,
    freshnessStaleHours: 24,
    coverageWeight: 0.45,
    reliabilityWeight: 0.55,
    scannerFailPenalty: 45,
    modelFailPenalty: 35,
    warningPenalty: 8,
    timeoutPenalty: 10,
    highConfidenceThreshold: 80,
    mediumConfidenceThreshold: 60,
    partialDataThreshold: 80,
    confidenceBase: 35,
    confidencePerSource: 12,
    confidenceWarningPenalty: 10,
    confidenceFallbackPenalty: 20,
  },
  analysis: {
    bounds: {
      grossMarginMin: 5,
      grossMarginMax: 99,
      monthlyInfraMax: 200000000,
      perUserInfraMax: 1000,
      buildTotalMax: 1000000000,
      buildMonthsMax: 120,
      teamSizeMax: 500,
      staffingMonthsMax: 1000,
      revenueInfraRatioMax: 2,
    },
    expectedSources: {
      infra: { fast: 2, full: 4 },
      build: { fast: 1, full: 3 },
      buyer: { fast: 1, full: 5 },
      risk: { fast: 1, full: 3 },
      competitors: { fast: 1, full: 1 },
    },
    expectedTasks: {
      infra: { fast: 1, full: 4 },
      build: { fast: 1, full: 3 },
      buyer: { fast: 1, full: 4 },
      risk: { fast: 1, full: 3 },
      competitors: { fast: 1, full: 1 },
    },
  },
};

export function getMissingRuntimeEnv() {
  const missing = [];
  if (!config.tinyfish.apiKey) missing.push("TINYFISH_API_KEY");
  if (!config.openai.apiKey) missing.push("OPENAI_API_KEY");
  return missing;
}

export function getExpectedSources(pillar, fastMode) {
  const mode = fastMode ? "fast" : "full";
  return config.analysis.expectedSources[pillar]?.[mode] ?? 1;
}

export function getExpectedTasks(pillar, fastMode) {
  const mode = fastMode ? "fast" : "full";
  return config.analysis.expectedTasks[pillar]?.[mode] ?? 1;
}
