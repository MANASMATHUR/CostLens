import { getInvestigationPillars } from "../tinyfish/pillars.js";

export class BuildCostEstimator {
  constructor(engine) {
    this.engine = engine;
  }

  async scan(targetUrl, options = {}) {
    const fast = options.fast === true;
    const extractedAt = new Date().toISOString();
    const pillars = getInvestigationPillars(targetUrl, new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`).hostname);

    const tasks = fast
      ? [this.runBuildPillar(pillars.build, targetUrl, options.onEvent)]
      : [this.runBuildPillar(pillars.build, targetUrl, options.onEvent), this.findOpenSourceComponents(targetUrl), this.getHiringCosts(targetUrl)];
    const results = await Promise.allSettled(tasks);

    const result = {
      features: results[0]?.status === "fulfilled" ? results[0].value : { detected: [], pricingPageFeatures: [] },
      openSource: !fast && results[1]?.status === "fulfilled" ? results[1].value : [],
      hiring: !fast && results[2]?.status === "fulfilled" ? results[2].value : null,
      fetchPrefetch: Boolean(results[0]?.status === "fulfilled" && results[0].value?.fetchPrefetch),
    };
    return { ...result, _meta: this.buildMeta({ pillar: "build", extractedAt, result }) };
  }

  async runBuildPillar(definition, targetUrl, onEvent) {
    let extraGoal = "";
    try {
      const fetched = await this.engine.fetchMarkdown(targetUrl);
      extraGoal = this.engine.formatFetchContext(fetched);
    } catch (error) {
      console.warn("[CostLens] Build fetch prefetch failed:", error?.message);
    }
    const response = await this.engine.runPillar(definition, { onEvent, extraGoal });
    const raw = this._coerceObject(response.result, { detected: [], pricingPageFeatures: [] });
    return { ...raw, fetchPrefetch: Boolean(extraGoal) };
  }

  async findOpenSourceComponents(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const companyName = domain.split(".")[0];
    const goal = [
      `Find likely open-source components or repositories linked to ${companyName}.`,
      "Return strict JSON array:",
      '[{ "name": "string|null", "url": "string|null" }]',
    ].join("\n");
    const response = await this.engine.client.runJson({ url, goal });
    const result = response.result;
    return Array.isArray(result) ? result : [];
  }

  async getHiringCosts(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const companyName = domain.split(".")[0];
    const goal = [
      `Estimate hiring and compensation benchmarks for ${companyName} engineering roles.`,
      'Return strict JSON: { "levels": [{ "level": string|null, "title": string|null, "totalComp": string|null }], "notes": [] }',
    ].join("\n");
    const response = await this.engine.client.runJson({ url: `https://${domain}`, goal });
    return this._coerceObject(response.result, { levels: [], notes: [] });
  }

  _coerceObject(value, fallback) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return fallback;
  }

  buildMeta({ pillar, extractedAt, result }) {
    const sourceFamilies = [];
    if (result?.features?.detected?.length || result?.features?.pricingPageFeatures?.length) sourceFamilies.push("features");
    if (Array.isArray(result?.openSource) && result.openSource.length > 0) sourceFamilies.push("openSource");
    if (this._hasDataObject(result?.hiring)) sourceFamilies.push("hiringBenchmarks");
    if (result?.fetchPrefetch) sourceFamilies.push("fetchApi");
    return { pillar, extractedAt, sourceFamilies, sourceCount: sourceFamilies.length };
  }

  _hasDataObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
  }
}
