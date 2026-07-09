import {
  ASYNC_PILLAR_ORDER,
  getInvestigationPillars,
  buildRunPayloads,
  PILLAR_SCHEMAS,
} from "./pillars.js";

export {
  ASYNC_PILLAR_ORDER,
  getInvestigationPillars,
  listPillarDefinitions,
  buildRunPayloads,
  buildAgentParams,
  PILLAR_SCHEMAS,
} from "./pillars.js";

export function getAsyncInvestigationGoals(targetUrl, domain) {
  const pillars = getInvestigationPillars(targetUrl, domain);
  const mapped = {};
  for (const [key, def] of Object.entries(pillars)) {
    mapped[key] = { url: def.url, goal: def.goal };
  }
  return mapped;
}

export function buildAsyncBatchRuns(goals, defaults) {
  const definitions = ASYNC_PILLAR_ORDER.map((pillar) => {
    const value = goals[pillar];
    return {
      pillar,
      url: value.url,
      goal: value.goal,
      outputSchema: PILLAR_SCHEMAS[pillar],
    };
  });
  return buildRunPayloads(definitions, defaults);
}
