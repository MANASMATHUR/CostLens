import { getInvestigationPillars } from "../tinyfish/pillars.js";

export class InfraCostScanner {
  constructor(engine) {
    this.engine = engine;
  }

  async scan(targetUrl, options = {}) {
    const fast = options.fast === true;
    const extractedAt = new Date().toISOString();
    const pillars = getInvestigationPillars(targetUrl, new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`).hostname);

    const tasks = fast
      ? [this.runInfraPillar(pillars.infra, targetUrl, options.onEvent)]
      : [
          this.runInfraPillar(pillars.infra, targetUrl, options.onEvent),
          this.detectThirdPartyServices(targetUrl),
          this.getEngineeringHeadcount(targetUrl),
        ];
    const results = await Promise.allSettled(tasks);

    if (fast) {
      const combined = results[0]?.status === "fulfilled" ? results[0].value : {};
      const result = {
        techStack: combined.techStack ?? null,
        traffic: combined.traffic ?? null,
        thirdParty: null,
        headcount: null,
        fetchPrefetch: Boolean(combined.fetchPrefetch),
      };
      return { ...result, _meta: this.buildMeta({ pillar: "infra", extractedAt, result }) };
    }

    const infra = results[0]?.status === "fulfilled" ? results[0].value : {};
    const result = {
      techStack: infra.techStack ?? null,
      traffic: infra.traffic ?? null,
      thirdParty: results[1]?.status === "fulfilled" ? results[1].value : null,
      headcount: results[2]?.status === "fulfilled" ? results[2].value : null,
      fetchPrefetch: Boolean(infra.fetchPrefetch),
    };
    return { ...result, _meta: this.buildMeta({ pillar: "infra", extractedAt, result }) };
  }

  async runInfraPillar(definition, targetUrl, onEvent) {
    let extraGoal = "";
    try {
      const fetched = await this.engine.fetchMarkdown(targetUrl);
      extraGoal = this.engine.formatFetchContext(fetched);
    } catch (error) {
      console.warn("[CostLens] Infra fetch prefetch failed:", error?.message);
    }

    const response = await this.engine.runPillar(definition, { onEvent, extraGoal });
    const raw = this._coerceObject(response.result);
    return {
      techStack: raw.techStack ?? raw,
      traffic: raw.traffic ?? null,
      fetchPrefetch: Boolean(extraGoal),
    };
  }

  async detectThirdPartyServices(url) {
    const goal = [
      "Identify third-party services and classify them by category.",
      "Focus on analytics, monitoring, support, billing, feature_flags, cdn, ads_social, auth, other.",
      "Return strict JSON array:",
      '[{ "host": "string", "count": number, "totalSize": number, "types": [], "category": "string" }]',
    ].join("\n");
    const response = await this.engine.client.runJson({ url, goal });
    const result = response.result;
    return Array.isArray(result) ? result : [];
  }

  async getEngineeringHeadcount(url) {
    const domain = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    const companyName = domain.split(".")[0];
    const goal = [
      `Estimate engineering headcount and salary signals for company "${companyName}".`,
      "Use public profile and compensation signals when available.",
      'Return strict JSON: { "engineeringCount": number|null, "rawText": string|null, "salaries": [{ "title": string|null, "salary": string|null }] }',
    ].join("\n");
    const response = await this.engine.client.runJson({ url: `https://${domain}`, goal });
    return this._coerceObject(response.result);
  }

  _coerceObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return {};
  }

  buildMeta({ pillar, extractedAt, result }) {
    const sourceFamilies = [];
    if (this._hasDataObject(result?.techStack)) sourceFamilies.push("techStack");
    if (this._hasDataObject(result?.traffic)) sourceFamilies.push("trafficSignals");
    if (Array.isArray(result?.thirdParty) && result.thirdParty.length > 0) sourceFamilies.push("thirdParty");
    if (this._hasDataObject(result?.headcount)) sourceFamilies.push("headcount");
    if (result?.fetchPrefetch) sourceFamilies.push("fetchApi");
    return { pillar, extractedAt, sourceFamilies, sourceCount: sourceFamilies.length };
  }

  _hasDataObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
  }
}
