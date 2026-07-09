import { getInvestigationPillars } from "../tinyfish/pillars.js";

export class BuyerCostAnalyzer {
  constructor(engine) {
    this.engine = engine;
  }

  async scan(targetUrl, options = {}) {
    const fast = options.fast === true;
    const extractedAt = new Date().toISOString();
    const pillars = getInvestigationPillars(targetUrl, new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`).hostname);

    const tasks = fast
      ? [this.runBuyerPillar(pillars.buyer, targetUrl, options.onEvent)]
      : [
          this.runBuyerPillar(pillars.buyer, targetUrl, options.onEvent),
          this.mineReviewsForCostComplaints(targetUrl),
          this.scanHelpDocsForLimits(targetUrl),
          this.extractCompetitorSignals(targetUrl),
        ];
    const results = await Promise.allSettled(tasks);

    const result = {
      pricing: results[0]?.status === "fulfilled" ? results[0].value?.pricing ?? results[0].value : null,
      reviewInsights: !fast && results[1]?.status === "fulfilled" ? results[1].value : [],
      limits: !fast && results[2]?.status === "fulfilled" ? results[2].value : [],
      competitors: !fast && results[3]?.status === "fulfilled" ? results[3].value : [],
      fetchPrefetch: Boolean(results[0]?.status === "fulfilled" && results[0].value?.fetchPrefetch),
      searchPrefetch: !fast && Boolean(results[1]?.status === "fulfilled"),
    };
    return { ...result, _meta: this.buildMeta({ pillar: "buyer", extractedAt, result }) };
  }

  async runBuyerPillar(definition, targetUrl, onEvent) {
    let extraGoal = "";
    try {
      const fetched = await this.engine.fetchMarkdown(targetUrl);
      extraGoal = this.engine.formatFetchContext(fetched);
    } catch (error) {
      console.warn("[CostLens] Buyer fetch prefetch failed:", error?.message);
    }
    const response = await this.engine.runPillar(definition, { onEvent, extraGoal });
    const pricing = this._coerceObject(response.result, { plans: [], finePrint: [] });
    return { pricing, fetchPrefetch: Boolean(extraGoal) };
  }

  async mineReviewsForCostComplaints(url) {
    const name = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.split(".")[0];
    let extraGoal = "";
    try {
      const search = await this.engine.search(`${name} SaaS pricing complaints overages G2 reddit`, {
        recency_minutes: 60 * 24 * 90,
      });
      extraGoal = this.engine.formatSearchContext(search?.results);
    } catch (error) {
      console.warn("[CostLens] Review search prefetch failed:", error?.message);
    }
    const goal = [
      `Extract public complaints and reviews about ${name} pricing, hidden costs, and overages.`,
      'Return strict JSON: { "g2": [{ "text": string }], "reddit": [{ "title": string }] }',
    ].join("\n");
    const response = await this.engine.client.runJson({
      url,
      goal: extraGoal ? `${goal}\n\nSearch context:\n${extraGoal}` : goal,
    });
    return this._coerceObject(response.result, { g2: [], reddit: [] });
  }

  async scanHelpDocsForLimits(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const goal = [
      `Find help/doc limits for ${domain}: rate limits, storage, file size, quota, fair use, overages.`,
      "Return strict JSON array:",
      '[{ "source": "string", "terms": ["string"] }]',
    ].join("\n");
    const response = await this.engine.client.runJson({ url: `https://${domain}`, goal });
    const result = response.result;
    return Array.isArray(result) ? result : [];
  }

  async extractCompetitorSignals(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const goal = [
      `Identify likely competitors and pricing signal snippets for ${domain}.`,
      "Return strict JSON array:",
      '[{ "name": "string", "cost": "string", "features": "string" }]',
    ].join("\n");
    const response = await this.engine.client.runJson({ url: `https://${domain}`, goal });
    const result = response.result;
    return Array.isArray(result) ? result : [];
  }

  _coerceObject(value, fallback) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return fallback;
  }

  buildMeta({ pillar, extractedAt, result }) {
    const sourceFamilies = [];
    if (result?.pricing?.plans?.length) sourceFamilies.push("pricing");
    if (result?.pricing?.finePrint?.length) sourceFamilies.push("pricingFinePrint");
    if (result?.fetchPrefetch) sourceFamilies.push("fetchApi");
    if (result?.searchPrefetch) sourceFamilies.push("searchApi");
    if (
      (Array.isArray(result?.reviewInsights?.g2) && result.reviewInsights.g2.length > 0) ||
      (Array.isArray(result?.reviewInsights?.reddit) && result.reviewInsights.reddit.length > 0)
    ) {
      sourceFamilies.push("reviews");
    }
    if (Array.isArray(result?.limits) && result.limits.length > 0) sourceFamilies.push("limitsDocs");
    if (Array.isArray(result?.competitors) && result.competitors.length > 0) sourceFamilies.push("competitors");
    return { pillar, extractedAt, sourceFamilies, sourceCount: sourceFamilies.length };
  }
}
