// ============================================================
// AI COST MODELER
// Synthesizes data from all three scanners using OpenAI
// to generate the final cost intelligence report
// ============================================================

import OpenAI from "openai";

export class CostModeler {
  constructor(config) {
    this.openai = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model || "gpt-4o";
  }

  async analyze(infraData, buildData, buyerData, targetInfo) {
    const [infraRes, buildRes, buyerRes] = await Promise.allSettled([
      this.analyzeInfraCosts(infraData, targetInfo),
      this.analyzeBuildCosts(buildData, targetInfo),
      this.analyzeBuyerCosts(buyerData, targetInfo),
    ]);

    return {
      infraCost: infraRes.status === "fulfilled" ? infraRes.value : this.getDefaultInfraCost(),
      buildCost: buildRes.status === "fulfilled" ? buildRes.value : this.getDefaultBuildCost(),
      buyerCost: buyerRes.status === "fulfilled" ? buyerRes.value : this.getDefaultBuyerCost(),
      quality: {
        modelErrors: {
          infra: infraRes.status === "rejected" ? this.errorMessage(infraRes.reason) : null,
          build: buildRes.status === "rejected" ? this.errorMessage(buildRes.reason) : null,
          buyer: buyerRes.status === "rejected" ? this.errorMessage(buyerRes.reason) : null,
        },
      },
    };
  }

  async analyzeInfraCosts(data, target) {
    const parsed = await this.requestJsonWithRetry({
      messages: [
        {
          role: "system",
          content: `You are an expert cloud infrastructure cost analyst. Given technical signals from a SaaS product, estimate monthly infrastructure costs.
Return strict JSON only:
{
  "monthlyEstimate": { "low": number, "mid": number, "high": number },
  "perUserEstimate": { "low": number, "mid": number, "high": number },
  "revenueEstimate": number,
  "grossMargin": { "low": number, "mid": number, "high": number },
  "breakdown": [{ "category": string, "estimate": string, "confidence": "high"|"medium"|"low", "evidence": string, "pct": number }],
  "signals": [{ "icon": string, "text": string }]
}
If data is sparse, return conservative values and explain uncertainty in evidence text.`,
        },
        {
          role: "user",
          content: `Analyze infrastructure costs for ${target.name} (${target.url}):
Tech Stack: ${JSON.stringify(data?.techStack || {})}
Traffic Data: ${JSON.stringify(data?.traffic || {})}
Third-Party Services: ${JSON.stringify(data?.thirdParty || [])}
Engineering Headcount: ${JSON.stringify(data?.headcount || {})}`,
        },
      ],
      maxTokens: 2000,
    });

    return this.normalizeInfraCost(parsed);
  }

  async analyzeBuildCosts(data, target) {
    const parsed = await this.requestJsonWithRetry({
      messages: [
        {
          role: "system",
          content: `You are an expert software development cost estimator. Given detected features and tech stack, estimate build cost from scratch.
Return strict JSON only:
{
  "totalEstimate": { "low": number, "mid": number, "high": number },
  "timeEstimate": { "low": number, "mid": number, "high": number },
  "teamSize": { "min": number, "optimal": number, "max": number },
  "breakdown": [{ "module": string, "effort": string, "cost": string, "complexity": "extreme"|"hard"|"medium", "notes": string }],
  "techStack": [{ "layer": string, "tech": string, "detected": boolean, "confidence": "high"|"medium"|"low" }]
}
Use conservative assumptions if source data is weak.`,
        },
        {
          role: "user",
          content: `Estimate build cost for ${target.name} (${target.url}):
Detected Features: ${JSON.stringify(data?.features || {})}
Open Source Components: ${JSON.stringify(data?.openSource || [])}
Market Salary Data: ${JSON.stringify(data?.hiring || {})}`,
        },
      ],
      maxTokens: 2500,
    });

    return this.normalizeBuildCost(parsed);
  }

  async analyzeBuyerCosts(data, target) {
    const parsed = await this.requestJsonWithRetry({
      messages: [
        {
          role: "system",
          content: `You are a SaaS procurement analyst uncovering hidden costs.
Return strict JSON only:
{
  "plans": [{ "name": string, "listed": string, "actualMonthly": string, "gotchas": [string], "hiddenCosts": [{ "item": string, "cost": string, "note": string }] }],
  "tcoComparison": [{ "scenario": string, "monthlyListed": string, "monthlyActual": string, "annualDelta": string, "note": string }],
  "competitorComparison": [{ "name": string, "cost": string, "features": string }]
}
If competitor data is unavailable, still provide a reasonable comparison set with explicit uncertainty in notes.`,
        },
        {
          role: "user",
          content: `Analyze true buyer costs for ${target.name} (${target.url}):
Pricing Data: ${JSON.stringify(data?.pricing || {})}
Review Insights: ${JSON.stringify(data?.reviewInsights || {})}
Documented Limits: ${JSON.stringify(data?.limits || [])}
Competitor Insights: ${JSON.stringify(data?.competitors || [])}`,
        },
      ],
      maxTokens: 2000,
    });

    return this.normalizeBuyerCost(parsed);
  }

  async requestJsonWithRetry({ messages, maxTokens, retries = 2 }) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.openai.chat.completions.create({
          model: this.model,
          messages,
          temperature: 0.3,
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        });

        const content = response?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") {
          throw new Error("Model returned empty content.");
        }
        return JSON.parse(content);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Model generation failed.");
  }

  normalizeInfraCost(value) {
    const fallback = this.getDefaultInfraCost();
    const input = this.asObject(value);
    const monthly = this.normalizeTriad(input.monthlyEstimate, { low: 200000, mid: 450000, high: 900000 });
    const perUser = this.normalizeTriad(input.perUserEstimate, { low: 0.2, mid: 0.45, high: 0.9 });
    const margin = this.normalizeTriad(input.grossMargin, { low: 70, mid: 82, high: 90 });
    const breakdown = Array.isArray(input.breakdown)
      ? input.breakdown.map((item) => ({
          category: this.asString(item?.category, "Unknown category"),
          estimate: this.asString(item?.estimate, "Unknown"),
          confidence: this.normalizeConfidence(item?.confidence),
          evidence: this.asString(item?.evidence, "Derived from limited public signals."),
          pct: this.asNumber(item?.pct, 0),
        }))
      : fallback.breakdown;
    const signals = Array.isArray(input.signals)
      ? input.signals.map((item) => ({
          icon: this.asString(item?.icon, "•"),
          text: this.asString(item?.text, "Signal data unavailable"),
        }))
      : fallback.signals;

    return {
      monthlyEstimate: monthly,
      perUserEstimate: perUser,
      revenueEstimate: this.asNumber(input.revenueEstimate, 0),
      grossMargin: margin,
      breakdown: breakdown.length > 0 ? breakdown : fallback.breakdown,
      signals: signals.length > 0 ? signals : fallback.signals,
    };
  }

  normalizeBuildCost(value) {
    const fallback = this.getDefaultBuildCost();
    const input = this.asObject(value);
    const totalEstimate = this.normalizeTriad(input.totalEstimate, { low: 1500000, mid: 3500000, high: 7000000 });
    const timeEstimate = this.normalizeTriad(input.timeEstimate, { low: 8, mid: 14, high: 24 });
    const teamSize = this.normalizeTeamSize(input.teamSize, fallback.teamSize);
    const breakdown = Array.isArray(input.breakdown)
      ? input.breakdown.map((item) => ({
          module: this.asString(item?.module, "Unknown module"),
          effort: this.asString(item?.effort, "Unknown"),
          cost: this.asString(item?.cost, "Unknown"),
          complexity: this.normalizeComplexity(item?.complexity),
          notes: this.asString(item?.notes, "Evidence limited; estimate uses conservative assumptions."),
        }))
      : fallback.breakdown;
    const techStack = Array.isArray(input.techStack)
      ? input.techStack.map((item) => ({
          layer: this.asString(item?.layer, "Unknown layer"),
          tech: this.asString(item?.tech, "Unknown"),
          detected: Boolean(item?.detected),
          confidence: this.normalizeConfidence(item?.confidence),
        }))
      : fallback.techStack;

    return {
      totalEstimate,
      timeEstimate,
      teamSize,
      breakdown: breakdown.length > 0 ? breakdown : fallback.breakdown,
      techStack: techStack.length > 0 ? techStack : fallback.techStack,
    };
  }

  normalizeBuyerCost(value) {
    const fallback = this.getDefaultBuyerCost();
    const input = this.asObject(value);
    const plans = Array.isArray(input.plans)
      ? input.plans.map((plan) => ({
          name: this.asString(plan?.name, "Unknown"),
          listed: this.asString(plan?.listed, "Unknown"),
          actualMonthly: this.asString(plan?.actualMonthly, "Unknown"),
          gotchas: Array.isArray(plan?.gotchas) ? plan.gotchas.map((x) => this.asString(x, "Unknown limitation")) : [],
          hiddenCosts: Array.isArray(plan?.hiddenCosts)
            ? plan.hiddenCosts.map((hc) => ({
                item: this.asString(hc?.item, "Unknown"),
                cost: this.asString(hc?.cost, "Unknown"),
                note: this.asString(hc?.note, "Estimate based on partial evidence."),
              }))
            : [],
        }))
      : fallback.plans;

    const tcoComparison = Array.isArray(input.tcoComparison)
      ? input.tcoComparison.map((row) => ({
          scenario: this.asString(row?.scenario, "Unknown scenario"),
          monthlyListed: this.asString(row?.monthlyListed, "Unknown"),
          monthlyActual: this.asString(row?.monthlyActual, "Unknown"),
          annualDelta: this.asString(row?.annualDelta, "Unknown"),
          note: this.asString(row?.note, "Estimate based on limited information."),
        }))
      : fallback.tcoComparison;

    const competitorComparison = Array.isArray(input.competitorComparison)
      ? input.competitorComparison.map((row) => ({
          name: this.asString(row?.name, "Unknown competitor"),
          cost: this.asString(row?.cost, "Unknown"),
          features: this.asString(row?.features, "N/A"),
        }))
      : fallback.competitorComparison;

    return {
      plans: plans.length > 0 ? plans : fallback.plans,
      tcoComparison: tcoComparison.length > 0 ? tcoComparison : fallback.tcoComparison,
      competitorComparison: competitorComparison.length > 0 ? competitorComparison : fallback.competitorComparison,
    };
  }

  getDefaultInfraCost() {
    return {
      monthlyEstimate: { low: 200000, mid: 450000, high: 900000 },
      perUserEstimate: { low: 0.2, mid: 0.45, high: 0.9 },
      revenueEstimate: 0,
      grossMargin: { low: 70, mid: 82, high: 90 },
      breakdown: [
        {
          category: "Infrastructure baseline",
          estimate: "Insufficient external evidence",
          confidence: "low",
          evidence: "Public data was limited during this run.",
          pct: 100,
        },
      ],
      signals: [{ icon: "•", text: "Limited signal quality. Treat estimates as directional." }],
    };
  }

  getDefaultBuildCost() {
    return {
      totalEstimate: { low: 1500000, mid: 3500000, high: 7000000 },
      timeEstimate: { low: 8, mid: 14, high: 24 },
      teamSize: { min: 6, optimal: 10, max: 18 },
      breakdown: [
        {
          module: "Core platform",
          effort: "Unknown",
          cost: "Unknown",
          complexity: "medium",
          notes: "Insufficient feature evidence to generate module-level confidence.",
        },
      ],
      techStack: [{ layer: "Application", tech: "Unknown", detected: false, confidence: "low" }],
    };
  }

  getDefaultBuyerCost() {
    return {
      plans: [
        {
          name: "Unknown",
          listed: "Unknown",
          actualMonthly: "Unknown",
          gotchas: ["Pricing evidence was limited in this scan."],
          hiddenCosts: [],
        },
      ],
      tcoComparison: [
        {
          scenario: "Typical team",
          monthlyListed: "Unknown",
          monthlyActual: "Unknown",
          annualDelta: "Unknown",
          note: "Insufficient pricing data to quantify delta.",
        },
      ],
      competitorComparison: [{ name: "Peer SaaS", cost: "Unknown", features: "Comparable feature set" }],
    };
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

  errorMessage(error) {
    if (!error) return "Unknown model error";
    if (typeof error === "string") return error;
    return error.message || "Unknown model error";
  }
}
