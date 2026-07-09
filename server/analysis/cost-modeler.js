import OpenAI from "openai";
import { buildEvidenceContext } from "./evidence.js";

const CITATION_SCHEMA = `"citations": [{ "source": string, "url": string|null, "snippet": string, "confidence": "high"|"medium"|"low" }]`;

export class CostModeler {
  constructor(config = {}) {
    this.openai = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || "gpt-4o";
    this.summaryModel = config.summaryModel || this.model;
    this.temperature = config.temperature ?? 0.2;
    this.retries = config.retries ?? 2;
    this.maxTokens = config.maxTokens || {};
    this.quality = config.quality || {};
    this.bounds = config.bounds || {};
  }

  async analyze(infraData, buildData, buyerData, targetInfo, enrichment = null) {
    const context = {
      infra: buildEvidenceContext(infraData, targetInfo.url),
      build: buildEvidenceContext(buildData, targetInfo.url),
      buyer: buildEvidenceContext(buyerData, targetInfo.url),
    };

    const [infraRes, buildRes, buyerRes] = await Promise.allSettled([
      this.analyzeInfraCosts(infraData, targetInfo, context.infra, enrichment),
      this.analyzeBuildCosts(buildData, targetInfo, context.build, enrichment),
      this.analyzeBuyerCosts(buyerData, targetInfo, context.buyer, enrichment),
    ]);

    const infraCost = infraRes.status === "fulfilled" ? infraRes.value : this.getDefaultInfraCost(context.infra);
    const buildCost = buildRes.status === "fulfilled" ? buildRes.value : this.getDefaultBuildCost(context.build);
    const buyerCost = buyerRes.status === "fulfilled" ? buyerRes.value : this.getDefaultBuyerCost(context.buyer);

    const crossValidation = this.crossValidateAgainstSignals({
      infraCost,
      buildCost,
      buyerCost,
      infraData,
      buildData,
      buyerData,
      enrichment,
    });

    infraCost.validationWarnings = [...new Set([...(infraCost.validationWarnings || []), ...crossValidation.infraWarnings])];
    buildCost.validationWarnings = [...new Set([...(buildCost.validationWarnings || []), ...crossValidation.buildWarnings])];
    buyerCost.validationWarnings = [...new Set([...(buyerCost.validationWarnings || []), ...crossValidation.buyerWarnings])];
    const anomalies = this.detectAnomalies({ infraCost, buildCost, buyerCost, crossValidationWarnings: crossValidation.anomalies });

    return {
      infraCost,
      buildCost,
      buyerCost,
      quality: {
        modelErrors: {
          infra: infraRes.status === "rejected" ? this.errorMessage(infraRes.reason) : null,
          build: buildRes.status === "rejected" ? this.errorMessage(buildRes.reason) : null,
          buyer: buyerRes.status === "rejected" ? this.errorMessage(buyerRes.reason) : null,
        },
        modelWarnings: {
          infra: Array.isArray(infraCost?.validationWarnings) ? infraCost.validationWarnings : [],
          build: Array.isArray(buildCost?.validationWarnings) ? buildCost.validationWarnings : [],
          buyer: Array.isArray(buyerCost?.validationWarnings) ? buyerCost.validationWarnings : [],
        },
        anomalies,
      },
    };
  }

  async analyzeInfraCosts(data, target, evidence, enrichment) {
    const parsed = await this.requestJsonWithRetry({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are an expert cloud infrastructure cost analyst. Estimate monthly infrastructure costs from scanner evidence only.
Rules:
- Never invent traffic, headcount, or vendor data that is absent from the input.
- Every breakdown item must cite a concrete signal in evidence text.
- If evidence is sparse, use low confidence, keep ranges wide, and set revenueEstimate to 0.
Return strict JSON:
{
  "monthlyEstimate": { "low": number, "mid": number, "high": number },
  "perUserEstimate": { "low": number, "mid": number, "high": number },
  "revenueEstimate": number,
  "grossMargin": { "low": number, "mid": number, "high": number },
  "breakdown": [{ "category": string, "estimate": string, "confidence": "high"|"medium"|"low", "evidence": string, "pct": number }],
  "signals": [{ "icon": string, "text": string }],
  ${CITATION_SCHEMA},
  "limitations": [string]
}`,
        },
        {
          role: "user",
          content: this.buildUserPrompt({
            title: `Infrastructure costs for ${target.name} (${target.url})`,
            evidence,
            enrichment: enrichment?.infra,
            payload: {
              techStack: data?.techStack || {},
              traffic: data?.traffic || {},
              thirdParty: data?.thirdParty || [],
              headcount: data?.headcount || {},
            },
          }),
        },
      ],
      maxTokens: this.maxTokens.infra || 2500,
    });

    return this.normalizeInfraCost(parsed, evidence);
  }

  async analyzeBuildCosts(data, target, evidence, enrichment) {
    const parsed = await this.requestJsonWithRetry({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are an expert software development cost estimator. Estimate build-from-scratch cost using detected features and hiring signals only.
Rules:
- Tie each module estimate to named detected features when possible.
- Do not assume enterprise scale without feature evidence.
- If feature evidence is missing, keep totals conservative and explain gaps in limitations.
Return strict JSON:
{
  "totalEstimate": { "low": number, "mid": number, "high": number },
  "timeEstimate": { "low": number, "mid": number, "high": number },
  "teamSize": { "min": number, "optimal": number, "max": number },
  "breakdown": [{ "module": string, "effort": string, "cost": string, "complexity": "extreme"|"hard"|"medium", "notes": string }],
  "techStack": [{ "layer": string, "tech": string, "detected": boolean, "confidence": "high"|"medium"|"low" }],
  ${CITATION_SCHEMA},
  "limitations": [string]
}`,
        },
        {
          role: "user",
          content: this.buildUserPrompt({
            title: `Build cost for ${target.name} (${target.url})`,
            evidence,
            enrichment: enrichment?.build,
            payload: {
              features: data?.features || {},
              openSource: data?.openSource || [],
              hiring: data?.hiring || {},
            },
          }),
        },
      ],
      maxTokens: this.maxTokens.build || 3000,
    });

    return this.normalizeBuildCost(parsed, evidence);
  }

  async analyzeBuyerCosts(data, target, evidence, enrichment) {
    const parsed = await this.requestJsonWithRetry({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a SaaS procurement analyst uncovering true buyer cost, hidden fees, and TCO deltas.
Rules:
- Distinguish listed price vs realistic monthly cost.
- Surface gotchas only when supported by pricing, review, or limits evidence.
- Do not fabricate competitor pricing; mark unknown values explicitly.
Return strict JSON:
{
  "plans": [{ "name": string, "listed": string, "actualMonthly": string, "gotchas": [string], "hiddenCosts": [{ "item": string, "cost": string, "note": string }] }],
  "tcoComparison": [{ "scenario": string, "monthlyListed": string, "monthlyActual": string, "annualDelta": string, "note": string }],
  "competitorComparison": [{ "name": string, "cost": string, "features": string }],
  ${CITATION_SCHEMA},
  "limitations": [string]
}`,
        },
        {
          role: "user",
          content: this.buildUserPrompt({
            title: `Buyer cost for ${target.name} (${target.url})`,
            evidence,
            enrichment: enrichment?.buyer,
            payload: {
              pricing: data?.pricing || {},
              reviewInsights: data?.reviewInsights || {},
              limits: data?.limits || [],
              competitors: data?.competitors || [],
            },
          }),
        },
      ],
      maxTokens: this.maxTokens.buyer || 2500,
    });

    return this.normalizeBuyerCost(parsed, evidence);
  }

  buildUserPrompt({ title, evidence, enrichment, payload }) {
    return `${title}
Evidence context: ${JSON.stringify(evidence)}
Derived signal counts: ${JSON.stringify(enrichment || {})}
Raw scanner payload: ${JSON.stringify(payload)}`;
  }

  async requestJsonWithRetry({ messages, maxTokens, model = this.model, retries = this.retries }) {
    let lastError = null;
    let repairContent = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const attemptMessages = repairContent
          ? [
              ...messages,
              { role: "assistant", content: repairContent },
              {
                role: "user",
                content: "The previous JSON was invalid or incomplete. Return corrected strict JSON only, preserving supported facts and marking unknowns explicitly.",
              },
            ]
          : messages;

        const response = await this.openai.chat.completions.create({
          model,
          messages: attemptMessages,
          temperature: this.temperature,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        });

        const content = response?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          throw new Error("Model returned empty content.");
        }
        try {
          return JSON.parse(content);
        } catch (parseError) {
          repairContent = content;
          throw parseError;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Model generation failed.");
  }

  normalizeInfraCost(value, evidence = { sourceCount: 0, hasEvidence: false, sourceFamilies: [] }) {
    const input = this.asObject(value);
    const insufficient = !evidence?.hasEvidence;
    const monthly = this.normalizeTriad(input.monthlyEstimate, { low: 0, mid: 0, high: 0 });
    const perUser = this.normalizeTriad(input.perUserEstimate, { low: 0, mid: 0, high: 0 });
    const margin = this.normalizeTriad(input.grossMargin, { low: 0, mid: 0, high: 0 });
    const breakdown = this.normalizeBreakdown(input.breakdown);
    const signals = this.normalizeSignals(input.signals);
    const citations = this.normalizeCitations(input.citations);
    const limitations = this.normalizeLimitations(input.limitations, insufficient);

    const evidenceSources = this.resolveEvidenceSources(evidence, input);
    const validationWarnings = this.validateInfraCost({
      monthlyEstimate: monthly,
      perUserEstimate: perUser,
      revenueEstimate: this.asNumber(input.revenueEstimate, 0),
      grossMargin: margin,
      breakdown,
      insufficient,
    });

    return {
      monthlyEstimate: monthly,
      perUserEstimate: perUser,
      revenueEstimate: this.asNumber(input.revenueEstimate, 0),
      grossMargin: margin,
      breakdown,
      signals,
      citations,
      limitations,
      evidenceSources,
      insufficientData: insufficient || breakdown.length === 0,
      confidence: this.buildConfidence({
        sourceCount: evidence.sourceCount,
        warningCount: validationWarnings.length + limitations.length,
        fallbackPenalty: breakdown.length === 0 ? this.quality.confidenceFallbackPenalty || 20 : 0,
        citationCount: citations.length,
      }),
      validationWarnings,
    };
  }

  normalizeBuildCost(value, evidence = { sourceCount: 0, hasEvidence: false, sourceFamilies: [] }) {
    const input = this.asObject(value);
    const insufficient = !evidence?.hasEvidence;
    const totalEstimate = this.normalizeTriad(input.totalEstimate, { low: 0, mid: 0, high: 0 });
    const timeEstimate = this.normalizeTriad(input.timeEstimate, { low: 0, mid: 0, high: 0 });
    const teamSize = this.normalizeTeamSize(input.teamSize, { min: 0, optimal: 0, max: 0 });
    const breakdown = Array.isArray(input.breakdown)
      ? input.breakdown.map((item) => ({
          module: this.asString(item?.module, "Unattributed module"),
          effort: this.asString(item?.effort, "Unknown"),
          cost: this.asString(item?.cost, "Unknown"),
          complexity: this.normalizeComplexity(item?.complexity),
          notes: this.asString(item?.notes, "Estimate derived from limited feature evidence."),
        }))
      : [];
    const techStack = Array.isArray(input.techStack)
      ? input.techStack.map((item) => ({
          layer: this.asString(item?.layer, "Application"),
          tech: this.asString(item?.tech, "Unknown"),
          detected: Boolean(item?.detected),
          confidence: this.normalizeConfidence(item?.confidence),
        }))
      : [];
    const citations = this.normalizeCitations(input.citations);
    const limitations = this.normalizeLimitations(input.limitations, insufficient);
    const evidenceSources = this.resolveEvidenceSources(evidence, input);
    const validationWarnings = this.validateBuildCost({ totalEstimate, timeEstimate, teamSize, breakdown, techStack, insufficient });

    return {
      totalEstimate,
      timeEstimate,
      teamSize,
      breakdown,
      techStack,
      citations,
      limitations,
      evidenceSources,
      insufficientData: insufficient || breakdown.length === 0,
      confidence: this.buildConfidence({
        sourceCount: evidence.sourceCount,
        warningCount: validationWarnings.length + limitations.length,
        fallbackPenalty: breakdown.length === 0 ? this.quality.confidenceFallbackPenalty || 20 : 0,
        citationCount: citations.length,
      }),
      validationWarnings,
    };
  }

  normalizeBuyerCost(value, evidence = { sourceCount: 0, hasEvidence: false, sourceFamilies: [] }) {
    const input = this.asObject(value);
    const insufficient = !evidence?.hasEvidence;
    const plans = Array.isArray(input.plans)
      ? input.plans.map((plan) => ({
          name: this.asString(plan?.name, "Unknown plan"),
          listed: this.asString(plan?.listed, "Unknown"),
          actualMonthly: this.asString(plan?.actualMonthly, "Unknown"),
          gotchas: Array.isArray(plan?.gotchas) ? plan.gotchas.map((x) => this.asString(x, "Unverified limitation")) : [],
          hiddenCosts: Array.isArray(plan?.hiddenCosts)
            ? plan.hiddenCosts.map((hc) => ({
                item: this.asString(hc?.item, "Unknown"),
                cost: this.asString(hc?.cost, "Unknown"),
                note: this.asString(hc?.note, "Requires verification."),
              }))
            : [],
        }))
      : [];
    const tcoComparison = Array.isArray(input.tcoComparison)
      ? input.tcoComparison.map((row) => ({
          scenario: this.asString(row?.scenario, "Typical team"),
          monthlyListed: this.asString(row?.monthlyListed, "Unknown"),
          monthlyActual: this.asString(row?.monthlyActual, "Unknown"),
          annualDelta: this.asString(row?.annualDelta, "Unknown"),
          note: this.asString(row?.note, "Estimate requires more pricing evidence."),
        }))
      : [];
    const competitorComparison = Array.isArray(input.competitorComparison)
      ? input.competitorComparison.map((row) => ({
          name: this.asString(row?.name, "Unknown competitor"),
          cost: this.asString(row?.cost, "Unknown"),
          features: this.asString(row?.features, "Unknown"),
        }))
      : [];
    const citations = this.normalizeCitations(input.citations);
    const limitations = this.normalizeLimitations(input.limitations, insufficient);
    const evidenceSources = this.resolveEvidenceSources(evidence, input);
    const validationWarnings = this.validateBuyerCost({ plans, tcoComparison, competitorComparison, insufficient });

    return {
      plans,
      tcoComparison,
      competitorComparison,
      citations,
      limitations,
      evidenceSources,
      insufficientData: insufficient || plans.length === 0,
      confidence: this.buildConfidence({
        sourceCount: evidence.sourceCount,
        warningCount: validationWarnings.length + limitations.length,
        fallbackPenalty: plans.length === 0 ? this.quality.confidenceFallbackPenalty || 20 : 0,
        citationCount: citations.length,
      }),
      validationWarnings,
    };
  }

  getDefaultInfraCost(evidence = { sourceCount: 0 }) {
    return {
      monthlyEstimate: { low: 0, mid: 0, high: 0 },
      perUserEstimate: { low: 0, mid: 0, high: 0 },
      revenueEstimate: 0,
      grossMargin: { low: 0, mid: 0, high: 0 },
      breakdown: [],
      signals: [],
      citations: [],
      limitations: ["Infrastructure synthesis failed or scanner evidence was unavailable."],
      evidenceSources: evidence.sourceFamilies || [],
      insufficientData: true,
      confidence: this.buildConfidence({ sourceCount: evidence.sourceCount || 0, warningCount: 2, fallbackPenalty: 20 }),
      validationWarnings: ["Infrastructure model output unavailable."],
    };
  }

  getDefaultBuildCost(evidence = { sourceCount: 0 }) {
    return {
      totalEstimate: { low: 0, mid: 0, high: 0 },
      timeEstimate: { low: 0, mid: 0, high: 0 },
      teamSize: { min: 0, optimal: 0, max: 0 },
      breakdown: [],
      techStack: [],
      citations: [],
      limitations: ["Build synthesis failed or feature evidence was unavailable."],
      evidenceSources: evidence.sourceFamilies || [],
      insufficientData: true,
      confidence: this.buildConfidence({ sourceCount: evidence.sourceCount || 0, warningCount: 2, fallbackPenalty: 20 }),
      validationWarnings: ["Build model output unavailable."],
    };
  }

  getDefaultBuyerCost(evidence = { sourceCount: 0 }) {
    return {
      plans: [],
      tcoComparison: [],
      competitorComparison: [],
      citations: [],
      limitations: ["Buyer-cost synthesis failed or pricing evidence was unavailable."],
      evidenceSources: evidence.sourceFamilies || [],
      insufficientData: true,
      confidence: this.buildConfidence({ sourceCount: evidence.sourceCount || 0, warningCount: 2, fallbackPenalty: 20 }),
      validationWarnings: ["Buyer model output unavailable."],
    };
  }

  resolveEvidenceSources(evidence, modelOutput) {
    const scannerFamilies = Array.isArray(evidence?.sourceFamilies) ? evidence.sourceFamilies : [];
    const modelFamilies = Array.isArray(modelOutput?.evidenceSources) ? modelOutput.evidenceSources : [];
    return [...new Set([...scannerFamilies, ...modelFamilies].filter(Boolean))];
  }

  buildConfidence({ sourceCount = 0, warningCount = 0, fallbackPenalty = 0, citationCount = 0 }) {
    const base = this.quality.confidenceBase ?? 35;
    const perSource = this.quality.confidencePerSource ?? 12;
    const warningPenalty = this.quality.confidenceWarningPenalty ?? 10;
    let score = base + sourceCount * perSource + citationCount * 4 - warningCount * warningPenalty - fallbackPenalty;
    score = Math.max(5, Math.min(95, Math.round(score)));
    const high = this.quality.highConfidenceThreshold ?? 80;
    const medium = this.quality.mediumConfidenceThreshold ?? 60;
    const level = score >= high ? "high" : score >= medium ? "medium" : "low";
    return { overall: score, level };
  }

  validateInfraCost(value) {
    const warnings = [];
    const margin = value?.grossMargin || {};
    const bounds = this.bounds;
    if (margin.high > (bounds.grossMarginMax ?? 99) || margin.low < (bounds.grossMarginMin ?? 5)) {
      warnings.push("Gross margin looks outside realistic SaaS ranges.");
    }
    if ((value?.monthlyEstimate?.high || 0) > (bounds.monthlyInfraMax ?? 200000000)) {
      warnings.push("Monthly infra high estimate exceeds configured bounds.");
    }
    if ((value?.perUserEstimate?.high || 0) > (bounds.perUserInfraMax ?? 1000)) {
      warnings.push("Per-user infra estimate appears unusually high.");
    }
    if ((value?.revenueEstimate || 0) < 0) warnings.push("Revenue estimate was negative and may be unreliable.");
    if (value?.insufficient) warnings.push("Infrastructure estimate generated with insufficient scanner evidence.");
    return warnings;
  }

  validateBuildCost(value) {
    const warnings = [];
    const bounds = this.bounds;
    if ((value?.teamSize?.max || 0) > (bounds.teamSizeMax ?? 500) || (value?.teamSize?.min || 0) < 0) {
      warnings.push("Team size range appears unrealistic.");
    }
    if ((value?.timeEstimate?.high || 0) > (bounds.buildMonthsMax ?? 120)) {
      warnings.push("Timeline high estimate is unusually long.");
    }
    if ((value?.totalEstimate?.high || 0) > (bounds.buildTotalMax ?? 1000000000)) {
      warnings.push("Build high estimate exceeds configured bounds.");
    }
    if (value?.insufficient) warnings.push("Build estimate generated with insufficient feature evidence.");
    return warnings;
  }

  validateBuyerCost(value) {
    const warnings = [];
    if (!Array.isArray(value?.plans) || value.plans.length === 0) warnings.push("Plan-level pricing evidence is missing.");
    if (!Array.isArray(value?.tcoComparison) || value.tcoComparison.length === 0) warnings.push("TCO comparison evidence is limited.");
    if (value?.insufficient) warnings.push("Buyer pricing analysis generated with insufficient scanner evidence.");
    return warnings;
  }

  detectAnomalies({ infraCost, buildCost, buyerCost, crossValidationWarnings = [] }) {
    const anomalies = [];
    const bounds = this.bounds;
    const monthlyMid = this.asNumber(infraCost?.monthlyEstimate?.mid, 0);
    const revenue = this.asNumber(infraCost?.revenueEstimate, 0);
    if (revenue > 0 && monthlyMid > revenue * (bounds.revenueInfraRatioMax ?? 2)) {
      anomalies.push("Infra monthly midpoint is high relative to inferred monthly revenue.");
    }
    const teamOptimal = this.asNumber(buildCost?.teamSize?.optimal, 0);
    const buildMonths = this.asNumber(buildCost?.timeEstimate?.mid, 0);
    if (teamOptimal > 0 && buildMonths > 0 && teamOptimal * buildMonths > (bounds.staffingMonthsMax ?? 1000)) {
      anomalies.push("Build staffing-month load appears unusually high.");
    }
    const buyerPlans = Array.isArray(buyerCost?.plans) ? buyerCost.plans : [];
    if (buyerPlans.length > 0 && buyerPlans.every((x) => this.asString(x?.actualMonthly, "Unknown") === "Unknown")) {
      anomalies.push("Buyer actual monthly pricing remained unknown across detected plans.");
    }
    if (infraCost?.insufficientData) anomalies.push("Infrastructure pillar marked insufficient data.");
    if (buildCost?.insufficientData) anomalies.push("Build pillar marked insufficient data.");
    if (buyerCost?.insufficientData) anomalies.push("Buyer pillar marked insufficient data.");
    return [...new Set([...anomalies, ...crossValidationWarnings])];
  }

  crossValidateAgainstSignals({ infraCost, buildCost, buyerCost, infraData, buildData, buyerData, enrichment }) {
    const infraWarnings = [];
    const buildWarnings = [];
    const buyerWarnings = [];
    const anomalies = [];

    const hasTrafficSignal = Boolean(enrichment?.infra?.trafficSignalCount || (infraData?.traffic && Object.keys(infraData.traffic).length > 0));
    if (!hasTrafficSignal && this.asNumber(infraCost?.revenueEstimate, 0) > 0) {
      infraWarnings.push("Revenue estimate inferred without concrete traffic signals.");
      anomalies.push("Revenue estimate exists but traffic evidence was missing.");
    }
    const hasInfraSignals = Boolean(enrichment?.infra?.techSignalCount || (infraData?.techStack && Object.keys(infraData.techStack).length > 0));
    if (!hasInfraSignals && this.asNumber(infraCost?.monthlyEstimate?.mid, 0) > 0) {
      infraWarnings.push("Infrastructure estimate inferred with sparse technical evidence.");
    }

    const featureCount = enrichment?.build?.detectedFeatureCount ?? (Array.isArray(buildData?.features?.detected) ? buildData.features.detected.length : 0);
    if (featureCount === 0 && this.asNumber(buildCost?.totalEstimate?.mid, 0) > 0) {
      buildWarnings.push("Build estimate produced without detected feature evidence.");
      anomalies.push("Build estimate exists but feature evidence was missing.");
    }

    const pricingPlans = enrichment?.buyer?.pricingPlanCount ?? (Array.isArray(buyerData?.pricing?.plans) ? buyerData.pricing.plans.length : 0);
    const extractedPlans = Array.isArray(buyerCost?.plans) ? buyerCost.plans.length : 0;
    if (pricingPlans === 0 && extractedPlans > 0) {
      buyerWarnings.push("Buyer plans were inferred without direct pricing-page extraction.");
      anomalies.push("Buyer plan output exceeds source pricing evidence.");
    }

    return { infraWarnings, buildWarnings, buyerWarnings, anomalies };
  }

  normalizeBreakdown(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      category: this.asString(item?.category, "Unattributed"),
      estimate: this.asString(item?.estimate, "Unknown"),
      confidence: this.normalizeConfidence(item?.confidence),
      evidence: this.asString(item?.evidence, "No direct evidence cited."),
      pct: this.asNumber(item?.pct, 0),
    }));
  }

  normalizeSignals(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({
      icon: this.asString(item?.icon, "•"),
      text: this.asString(item?.text, "Signal unavailable"),
    }));
  }

  normalizeCitations(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => ({
        source: this.asString(item?.source, ""),
        url: typeof item?.url === "string" ? item.url : null,
        snippet: this.asString(item?.snippet, ""),
        confidence: this.normalizeConfidence(item?.confidence),
      }))
      .filter((item) => item.source && item.snippet);
  }

  normalizeLimitations(items, insufficient) {
    const list = Array.isArray(items) ? items.map((x) => this.asString(x)).filter(Boolean) : [];
    if (insufficient && !list.some((x) => /insufficient|limited|sparse/i.test(x))) {
      list.push("Scanner evidence was limited for this pillar.");
    }
    return list;
  }

  normalizeTriad(value, fallback) {
    const source = this.asObject(value);
    const low = this.asNumber(source.low, fallback.low);
    const mid = this.asNumber(source.mid, fallback.mid);
    const high = this.asNumber(source.high, fallback.high);
    const sorted = [low, mid, high].sort((a, b) => a - b);
    return { low: sorted[0], mid: sorted[1], high: sorted[2] };
  }

  normalizeTeamSize(value, fallback) {
    const source = this.asObject(value);
    const min = this.asNumber(source.min, fallback.min);
    const optimal = this.asNumber(source.optimal, fallback.optimal);
    const max = this.asNumber(source.max, fallback.max);
    const sorted = [min, optimal, max].sort((a, b) => a - b);
    return { min: sorted[0], optimal: sorted[1], max: sorted[2] };
  }

  normalizeConfidence(value) {
    return ["high", "medium", "low"].includes(value) ? value : "low";
  }

  normalizeComplexity(value) {
    return ["extreme", "hard", "medium"].includes(value) ? value : "medium";
  }

  asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  asNumber(value, fallback = 0) {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  asString(value, fallback = "") {
    return typeof value === "string" && value.trim().length > 0 ? value : fallback;
  }

  async generateExecutiveSummary(infraCost, buildCost, buyerCost, targetInfo) {
    try {
      const parsed = await this.requestJsonWithRetry({
        model: this.summaryModel,
        messages: [
          {
            role: "system",
            content: `You are an executive SaaS analyst. Produce a decision-ready summary grounded in the supplied cost pillars, citations, and limitations.
Return strict JSON:
{
  "summary": string,
  "keyFindings": [string],
  "recommendations": [{ "title": string, "detail": string, "priority": "high"|"medium"|"low", "evidence": string }],
  "verdictLabel": "Strong Value"|"Fair Market"|"Overpriced"|"Insufficient Data",
  "dataGaps": [string]
}
If any pillar has insufficientData=true, verdictLabel must be "Insufficient Data".`,
          },
          {
            role: "user",
            content: `Executive summary for ${targetInfo.name} (${targetInfo.url}):
Infrastructure: ${JSON.stringify(infraCost || {})}
Build: ${JSON.stringify(buildCost || {})}
Buyer: ${JSON.stringify(buyerCost || {})}`,
          },
        ],
        maxTokens: this.maxTokens.executive || 1800,
      });
      return this.normalizeExecutiveSummary(parsed);
    } catch (error) {
      console.error("[CostLens] Executive summary generation failed:", error);
      return null;
    }
  }

  normalizeExecutiveSummary(value) {
    const input = this.asObject(value);
    const summary = this.asString(input.summary, "");
    if (!summary) return null;
    return {
      summary,
      keyFindings: Array.isArray(input.keyFindings) ? input.keyFindings.map((x) => this.asString(x)).filter(Boolean) : [],
      recommendations: Array.isArray(input.recommendations)
        ? input.recommendations
            .map((r) => ({
              title: this.asString(r?.title, "Recommendation"),
              detail: this.asString(r?.detail, ""),
              priority: ["high", "medium", "low"].includes(r?.priority) ? r.priority : "medium",
              evidence: this.asString(r?.evidence, ""),
            }))
            .filter((r) => r.detail)
        : [],
      verdictLabel: this.asString(input.verdictLabel, "Insufficient Data"),
      dataGaps: Array.isArray(input.dataGaps) ? input.dataGaps.map((x) => this.asString(x)).filter(Boolean) : [],
    };
  }

  async generateNegotiationPlaybook(infraCost, buyerCost, targetInfo) {
    try {
      const parsed = await this.requestJsonWithRetry({
        model: this.summaryModel,
        messages: [
          {
            role: "system",
            content: `You are a SaaS procurement negotiation expert. Build a playbook from vendor margin signals and buyer pricing evidence.
Return strict JSON:
{
  "leverageFactors": [{ "factor": string, "explanation": string, "proof": string }],
  "talkingPoints": [string],
  "counterOffers": [{ "plan": string, "currentPrice": string, "suggestedTarget": string, "rationale": string, "proof": string }],
  "riskWarnings": [string]
}
Do not recommend aggressive discounts without supporting proof.`,
          },
          {
            role: "user",
            content: `Negotiation playbook for ${targetInfo.name} (${targetInfo.url}):
Vendor infra and margins: ${JSON.stringify(infraCost || {})}
Buyer pricing: ${JSON.stringify(buyerCost || {})}`,
          },
        ],
        maxTokens: this.maxTokens.negotiation || 1800,
      });
      return this.normalizeNegotiationPlaybook(parsed);
    } catch (error) {
      console.error("[CostLens] Negotiation playbook generation failed:", error);
      return null;
    }
  }

  normalizeNegotiationPlaybook(value) {
    const input = this.asObject(value);
    const leverageFactors = Array.isArray(input.leverageFactors)
      ? input.leverageFactors
          .map((f) => ({
            factor: this.asString(f?.factor, ""),
            explanation: this.asString(f?.explanation, ""),
            proof: this.asString(f?.proof, ""),
          }))
          .filter((f) => f.factor && f.explanation)
      : [];
    const talkingPoints = Array.isArray(input.talkingPoints) ? input.talkingPoints.map((x) => this.asString(x)).filter(Boolean) : [];
    if (leverageFactors.length === 0 && talkingPoints.length === 0) return null;
    return {
      leverageFactors,
      talkingPoints,
      counterOffers: Array.isArray(input.counterOffers)
        ? input.counterOffers
            .map((c) => ({
              plan: this.asString(c?.plan, "Unknown"),
              currentPrice: this.asString(c?.currentPrice, "Unknown"),
              suggestedTarget: this.asString(c?.suggestedTarget, "Unknown"),
              rationale: this.asString(c?.rationale, ""),
              proof: this.asString(c?.proof, ""),
            }))
            .filter((c) => c.rationale)
        : [],
      riskWarnings: Array.isArray(input.riskWarnings) ? input.riskWarnings.map((x) => this.asString(x)).filter(Boolean) : [],
    };
  }

  async analyzeRiskProfile(riskData, targetInfo, enrichment = null) {
    try {
      const evidence = buildEvidenceContext(riskData, targetInfo.url);
      const parsed = await this.requestJsonWithRetry({
        model: this.summaryModel,
        messages: [
          {
            role: "system",
            content: `You are a cybersecurity and compliance analyst. Build a risk profile from scanner evidence only.
Return strict JSON:
{
  "overallRiskLevel": "low"|"medium"|"high"|"critical",
  "securityScore": number,
  "complianceBadges": [{ "name": string, "status": "verified"|"claimed"|"missing", "evidence": string }],
  "findings": [{ "category": string, "severity": "info"|"warning"|"critical", "detail": string, "evidence": string }],
  "trackerSummary": { "total": number, "categories": {} },
  "recommendations": [string],
  "limitations": [string]
}`,
          },
          {
            role: "user",
            content: `Risk profile for ${targetInfo.name} (${targetInfo.url})
Evidence: ${JSON.stringify(evidence)}
Derived counts: ${JSON.stringify(enrichment?.risk || {})}
Security headers: ${JSON.stringify(riskData?.securityHeaders || {})}
Privacy and compliance: ${JSON.stringify(riskData?.privacyCompliance || {})}
Trackers: ${JSON.stringify(riskData?.trackers || [])}`,
          },
        ],
        maxTokens: this.maxTokens.risk || 1800,
      });
      return this.normalizeRiskProfile(parsed, evidence);
    } catch (error) {
      console.error("[CostLens] Risk profile analysis failed:", error);
      return this.getDefaultRiskProfile();
    }
  }

  normalizeRiskProfile(value, evidence = { sourceCount: 0 }) {
    const input = this.asObject(value);
    const insufficient = !evidence?.hasEvidence;
    return {
      overallRiskLevel: ["low", "medium", "high", "critical"].includes(input.overallRiskLevel) ? input.overallRiskLevel : insufficient ? "medium" : "medium",
      securityScore: insufficient ? 0 : Math.max(0, Math.min(100, this.asNumber(input.securityScore, 0))),
      complianceBadges: Array.isArray(input.complianceBadges)
        ? input.complianceBadges.map((b) => ({
            name: this.asString(b?.name, "Unknown"),
            status: ["verified", "claimed", "missing"].includes(b?.status) ? b.status : "missing",
            evidence: this.asString(b?.evidence, ""),
          }))
        : [],
      findings: Array.isArray(input.findings)
        ? input.findings
            .map((f) => ({
              category: this.asString(f?.category, "General"),
              severity: ["info", "warning", "critical"].includes(f?.severity) ? f.severity : "info",
              detail: this.asString(f?.detail, ""),
              evidence: this.asString(f?.evidence, ""),
            }))
            .filter((f) => f.detail)
        : insufficient
          ? [{ category: "Data quality", severity: "info", detail: "Risk scan evidence was limited.", evidence: "" }]
          : [],
      trackerSummary: {
        total: this.asNumber(input.trackerSummary?.total, 0),
        categories: this.asObject(input.trackerSummary?.categories),
      },
      recommendations: Array.isArray(input.recommendations) ? input.recommendations.map((x) => this.asString(x)).filter(Boolean) : [],
      limitations: this.normalizeLimitations(input.limitations, insufficient),
      evidenceSources: evidence.sourceFamilies || [],
      insufficientData: insufficient,
    };
  }

  getDefaultRiskProfile() {
    return {
      overallRiskLevel: "medium",
      securityScore: 0,
      complianceBadges: [],
      findings: [{ category: "Data quality", severity: "info", detail: "Risk scan data was insufficient for a full profile.", evidence: "" }],
      trackerSummary: { total: 0, categories: {} },
      recommendations: ["Re-run with a deeper scan for more comprehensive risk analysis."],
      limitations: ["Risk model output unavailable."],
      evidenceSources: [],
      insufficientData: true,
    };
  }

  async generateCompetitorAnalysis(competitorsRaw, buyerCost, targetInfo) {
    try {
      const rawCompetitors = competitorsRaw?.competitors || [];
      if (rawCompetitors.length === 0) return null;
      const evidence = buildEvidenceContext(competitorsRaw, targetInfo.url);

      const parsed = await this.requestJsonWithRetry({
        model: this.summaryModel,
        messages: [
          {
            role: "system",
            content: `You are a SaaS competitive intelligence analyst. Compare discovered competitors against the target using only supplied data.
Return strict JSON:
{
  "landscape": string,
  "competitors": [{ "name": string, "url": string, "description": string, "startingPrice": string, "positioning": { "priceLevel": number, "featureRichness": number }, "prosVsTarget": [string], "consVsTarget": [string], "evidence": string }],
  "targetPositioning": { "priceLevel": number, "featureRichness": number },
  "verdict": string,
  "limitations": [string]
}`,
          },
          {
            role: "user",
            content: `Competitor analysis for ${targetInfo.name} (${targetInfo.url}):
Discovered competitors: ${JSON.stringify(rawCompetitors)}
Target buyer pricing: ${JSON.stringify(buyerCost || {})}`,
          },
        ],
        maxTokens: this.maxTokens.competitors || 2200,
      });
      return this.normalizeCompetitorAnalysis(parsed, evidence);
    } catch (error) {
      console.error("[CostLens] Competitor analysis generation failed:", error);
      return null;
    }
  }

  normalizeCompetitorAnalysis(value, evidence = { sourceCount: 0, sourceFamilies: [] }) {
    const input = this.asObject(value);
    const landscape = this.asString(input.landscape, "");
    const competitors = Array.isArray(input.competitors)
      ? input.competitors
          .map((c) => ({
            name: this.asString(c?.name, "Unknown"),
            url: this.asString(c?.url, ""),
            description: this.asString(c?.description, ""),
            startingPrice: this.asString(c?.startingPrice, "Unknown"),
            positioning: {
              priceLevel: Math.max(1, Math.min(5, this.asNumber(c?.positioning?.priceLevel, 3))),
              featureRichness: Math.max(1, Math.min(5, this.asNumber(c?.positioning?.featureRichness, 3))),
            },
            prosVsTarget: Array.isArray(c?.prosVsTarget) ? c.prosVsTarget.map((x) => this.asString(x)).filter(Boolean).slice(0, 3) : [],
            consVsTarget: Array.isArray(c?.consVsTarget) ? c.consVsTarget.map((x) => this.asString(x)).filter(Boolean).slice(0, 3) : [],
            evidence: this.asString(c?.evidence, ""),
          }))
          .filter((c) => c.name !== "Unknown")
      : [];
    if (competitors.length === 0) return null;
    return {
      landscape,
      competitors,
      targetPositioning: {
        priceLevel: Math.max(1, Math.min(5, this.asNumber(input.targetPositioning?.priceLevel, 3))),
        featureRichness: Math.max(1, Math.min(5, this.asNumber(input.targetPositioning?.featureRichness, 3))),
      },
      verdict: this.asString(input.verdict, "Competitive positioning requires more evidence."),
      limitations: Array.isArray(input.limitations) ? input.limitations.map((x) => this.asString(x)).filter(Boolean) : [],
      evidenceSources: evidence.sourceFamilies || [],
    };
  }

  errorMessage(error) {
    if (!error) return "Unknown model error";
    if (typeof error === "string") return error;
    return error.message || "Unknown model error";
  }
}
