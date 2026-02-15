// ============================================================
// BUYER COST ANALYZER
// Pillar 3: What it ACTUALLY costs the buyer
// Uses TinyFish run automation + structured extraction goals
// ============================================================

export class BuyerCostAnalyzer {
  constructor(tinyfishClient) {
    this.tinyfish = tinyfishClient;
  }

  async scan(targetUrl, options = {}) {
    const fast = options.fast === true;
    const tasks = fast
      ? [this.extractPricing(targetUrl)]
      : [
          this.extractPricing(targetUrl),
          this.mineReviewsForCostComplaints(targetUrl),
          this.scanHelpDocsForLimits(targetUrl),
          this.extractCompetitorSignals(targetUrl),
        ];
    const results = await Promise.allSettled(tasks);
    return {
      pricing: results[0]?.status === "fulfilled" ? results[0].value : null,
      reviewInsights: !fast && results[1]?.status === "fulfilled" ? results[1].value : [],
      limits: !fast && results[2]?.status === "fulfilled" ? results[2].value : [],
      competitors: !fast && results[3]?.status === "fulfilled" ? results[3].value : [],
    };
  }

  async extractPricing(url) {
    const goal = [
      "Find and extract pricing page details including plan cards and fine print.",
      "Return strict JSON only:",
      "{",
      '  "plans": [{ "name": "string", "price": "string", "features": ["string"], "limits": ["string"] }],',
      '  "finePrint": ["string"]',
      "}",
    ].join("\n");

    const response = await this.tinyfish.runJson({ url, goal });
    return this._coerceObject(response.result, { plans: [], finePrint: [] });
  }

  async mineReviewsForCostComplaints(url) {
    const name = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.split(".")[0];
    const goal = [
      `Extract public complaints and reviews about ${name} pricing, hidden costs, and overages.`,
      "Return strict JSON only:",
      "{",
      '  "g2": [{ "text": "string" }],',
      '  "reddit": [{ "title": "string" }]',
      "}",
    ].join("\n");

    const response = await this.tinyfish.runJson({ url, goal });
    return this._coerceObject(response.result, { g2: [], reddit: [] });
  }

  async scanHelpDocsForLimits(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const goal = [
      `Find help/doc limits for ${domain}: rate limits, storage, file size, quota, fair use, overages.`,
      "Return strict JSON only as an array:",
      '[{ "source": "string", "terms": ["string"] }]',
    ].join("\n");

    const response = await this.tinyfish.runJson({ url: `https://${domain}`, goal });
    const result = response.result;
    return Array.isArray(result) ? result : [];
  }

  async extractCompetitorSignals(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const goal = [
      `Identify likely competitors and pricing signal snippets for ${domain}.`,
      "Return strict JSON only as an array:",
      '[{ "name": "string", "cost": "string", "features": "string" }]',
    ].join("\n");

    const response = await this.tinyfish.runJson({ url: `https://${domain}`, goal });
    const result = response.result;
    return Array.isArray(result) ? result : [];
  }

  _coerceObject(value, fallback) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return fallback;
  }
}
