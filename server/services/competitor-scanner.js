import { companyNameFromDomain, registrableDomain } from "../utils/domain.js";
import { getInvestigationPillars } from "../tinyfish/pillars.js";

export class CompetitorScanner {
  constructor(engine) {
    this.engine = engine;
  }

  async scan(targetUrl, domain, options = {}) {
    const name = companyNameFromDomain(domain);
    const baseDomain = registrableDomain(domain);
    const pillars = getInvestigationPillars(targetUrl, domain);
    const definition = pillars.competitors;

    let extraGoal = "";
    try {
      const search = await this.engine.search(`${name} ${baseDomain} SaaS alternatives competitors`, {
        recency_minutes: 60 * 24 * 30,
      });
      const context = this.engine.formatSearchContext(search?.results);
      if (context) {
        extraGoal = `TinyFish Search API results:\n${context}`;
      }
    } catch (error) {
      console.warn("[CostLens] Competitor search prefetch failed:", error?.message);
    }

    const response = await this.engine.runPillar(definition, { onEvent: options?.onEvent, extraGoal });
    const competitors = Array.isArray(response?.result?.competitors) ? response.result.competitors : [];
    const filtered = competitors.filter((c) => c && typeof c.name === "string" && c.name.trim());
    const sourceFamilies = ["competitors"];
    if (extraGoal) sourceFamilies.push("searchApi");
    return {
      competitors: filtered,
      searchSeeds: extraGoal ? true : false,
      _meta: {
        pillar: "competitors",
        extractedAt: new Date().toISOString(),
        sourceFamilies: filtered.length > 0 ? sourceFamilies : extraGoal ? ["searchApi"] : [],
        sourceCount: filtered.length > 0 ? sourceFamilies.length : extraGoal ? 1 : 0,
      },
    };
  }
}
