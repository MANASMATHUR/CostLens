import { companyNameFromDomain } from "../utils/domain.js";
import {
  infraOutputSchema,
  buildOutputSchema,
  buyerOutputSchema,
  riskOutputSchema,
  competitorsOutputSchema,
} from "./schemas.js";

export const ASYNC_PILLAR_ORDER = ["infra", "build", "buyer", "risk", "competitors"];

export const PILLAR_SCHEMAS = {
  infra: infraOutputSchema,
  build: buildOutputSchema,
  buyer: buyerOutputSchema,
  risk: riskOutputSchema,
  competitors: competitorsOutputSchema,
};

function targetUrl(input) {
  return input.startsWith("http") ? input : `https://${input}`;
}

export function getInvestigationPillars(rawUrl, domain) {
  const url = targetUrl(rawUrl);
  const name = companyNameFromDomain(domain);

  return {
    infra: {
      pillar: "infra",
      url,
      outputSchema: infraOutputSchema,
      goal: [
        `You are investigating ${name} (${domain}). Infer infrastructure and traffic signals from the live site and any public intelligence pages you can reach.`,
        "Visit the homepage, view-source or network signals if needed, and check public traffic hints when available.",
        "Return JSON with techStack (framework, cdn, cloud hints, signals) and traffic (confidence, notes).",
        "If a signal is not observed, use null or empty objects — never invent traffic ranks or cloud vendors.",
      ].join(" "),
    },
    build: {
      pillar: "build",
      url,
      outputSchema: buildOutputSchema,
      goal: [
        `Analyze ${name} (${domain}) product surface to estimate build-from-scratch complexity.`,
        "Inspect the marketing site, product pages, and pricing/feature lists.",
        "Return detected features with complexity (extreme|hard|medium) and evidence strings tied to pages you saw.",
        "Include pricingPageFeatures when visible on the pricing page.",
      ].join(" "),
    },
    buyer: {
      pillar: "buyer",
      url,
      outputSchema: buyerOutputSchema,
      goal: [
        `Extract buyer-facing pricing for ${name} (${domain}).`,
        "Find the pricing page, plan cards, seat/usage limits, and fine print (overages, minimums, annual billing).",
        "Return plans with name, price, features, limits arrays plus finePrint strings.",
        "Use exact prices shown on-page; if pricing is gated, say so in finePrint.",
      ].join(" "),
    },
    risk: {
      pillar: "risk",
      url,
      outputSchema: riskOutputSchema,
      goal: [
        `Audit ${domain} for security, privacy, and compliance signals visible to a buyer.`,
        "Check HTTPS/HSTS/CSP/header hints, privacy policy + terms links, cookie consent, compliance badges, and third-party trackers.",
        "Only list compliance badges explicitly shown on the site.",
        "Return securityHeaders, privacyCompliance, and trackers array.",
      ].join(" "),
    },
    competitors: {
      pillar: "competitors",
      url,
      outputSchema: competitorsOutputSchema,
      goal: [
        `Discover 3-5 credible competitors or alternatives to ${name}.`,
        "Use comparison pages, review sites (G2, Capterra), and search results when helpful.",
        "Return competitors with name, url, description, startingPrice, keyDifferentiator.",
        "Prefer fewer high-confidence entries over speculative guesses.",
      ].join(" "),
    },
  };
}

export function listPillarDefinitions(rawUrl, domain) {
  const pillars = getInvestigationPillars(rawUrl, domain);
  return ASYNC_PILLAR_ORDER.map((key) => pillars[key]);
}

export function buildRunPayloads(definitions, { browserProfile, proxyConfig }) {
  return definitions.map((def) => ({
    url: def.url,
    goal: def.goal,
    browser_profile: browserProfile,
    output_schema: def.outputSchema,
    ...(proxyConfig ? { proxy_config: proxyConfig } : {}),
  }));
}

export function buildAgentParams(definition, { browserProfile, proxyConfig }, extraGoal = "") {
  return {
    url: definition.url,
    goal: extraGoal ? `${definition.goal}\n\nAdditional context:\n${extraGoal}` : definition.goal,
    browserProfile,
    proxyConfig,
    outputSchema: definition.outputSchema,
  };
}
