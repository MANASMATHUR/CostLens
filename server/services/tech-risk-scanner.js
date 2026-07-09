import { getInvestigationPillars } from "../tinyfish/pillars.js";

export class TechRiskScanner {
  constructor(engine) {
    this.engine = engine;
  }

  async scan(targetUrl, options = {}) {
    const fast = options.fast === true;
    const extractedAt = new Date().toISOString();
    const domain = new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`).hostname;
    const pillars = getInvestigationPillars(targetUrl, domain);

    const tasks = fast
      ? [this.runRiskPillar(pillars.risk, targetUrl, options.onEvent)]
      : [
          this.scanSecurityHeaders(targetUrl, domain),
          this.scanPrivacyCompliance(targetUrl, domain),
          this.scanThirdPartyTrackers(targetUrl, domain),
        ];

    const results = await Promise.allSettled(tasks);

    if (fast) {
      const combined = results[0]?.status === "fulfilled" ? results[0].value : {};
      const result = {
        securityHeaders: combined.securityHeaders ?? null,
        privacyCompliance: combined.privacyCompliance ?? null,
        trackers: combined.trackers ?? [],
      };
      result._meta = this.buildMeta(result, extractedAt);
      return result;
    }

    const result = {
      securityHeaders: results[0]?.status === "fulfilled" ? results[0].value : null,
      privacyCompliance: results[1]?.status === "fulfilled" ? results[1].value : null,
      trackers: results[2]?.status === "fulfilled" ? results[2].value : [],
    };
    result._meta = this.buildMeta(result, extractedAt);
    return result;
  }

  async runRiskPillar(definition, targetUrl, onEvent) {
    let extraGoal = "";
    try {
      const fetched = await this.engine.fetchMarkdown(targetUrl);
      extraGoal = this.engine.formatFetchContext(fetched, 2500);
    } catch (error) {
      console.warn("[CostLens] Risk fetch prefetch failed:", error?.message);
    }
    const response = await this.engine.runPillar(definition, { onEvent, extraGoal });
    return this._coerceCombinedRisk(response);
  }

  _coerceCombinedRisk(response) {
    const raw = response?.result && typeof response.result === "object" ? response.result : {};
    return {
      securityHeaders: raw.securityHeaders ?? null,
      privacyCompliance: raw.privacyCompliance ?? null,
      trackers: Array.isArray(raw.trackers) ? raw.trackers : [],
    };
  }

  async scanSecurityHeaders(targetUrl, domain) {
    const response = await this.engine.client.runJson({
      url: targetUrl,
      goal: `Analyze security headers, HTTPS, CSP, HSTS, X-Frame-Options, X-Content-Type-Options, and cookie flags for ${domain}. Return strict JSON with https, hsts, csp, xFrameOptions, xContentTypeOptions, cookieFlags, notes.`,
    });
    return response?.result ?? null;
  }

  async scanPrivacyCompliance(targetUrl, domain) {
    const response = await this.engine.client.runJson({
      url: targetUrl,
      goal: `Find privacy policy, terms, compliance badges, and cookie consent on ${domain}. Return strict JSON with privacyPolicyUrl, termsUrl, complianceBadges, cookieConsent, dataProcessingInfo.`,
    });
    return response?.result ?? null;
  }

  async scanThirdPartyTrackers(targetUrl, domain) {
    const response = await this.engine.client.runJson({
      url: targetUrl,
      goal: `Identify third-party trackers on ${domain}. Return strict JSON array: [{ "tracker": string, "category": string, "dataShared": string }]`,
    });
    const result = response?.result;
    return Array.isArray(result) ? result : Array.isArray(result?.trackers) ? result.trackers : [];
  }

  buildMeta(result, extractedAt) {
    const sourceFamilies = [];
    if (this._hasData(result?.securityHeaders)) sourceFamilies.push("securityHeaders");
    if (this._hasData(result?.privacyCompliance)) sourceFamilies.push("privacyCompliance");
    if (Array.isArray(result?.trackers) && result.trackers.length > 0) sourceFamilies.push("trackers");
    return { extractedAt, sourceFamilies, sourceCount: sourceFamilies.length };
  }

  _hasData(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
  }
}
