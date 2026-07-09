import { EventType } from "@tiny-fish/sdk";
import { TinyFishWebAgentClient } from "./tinyfish-web-agent-client.js";
import {
  listPillarDefinitions,
  buildRunPayloads,
  buildAgentParams,
  getInvestigationPillars,
} from "./pillars.js";

export class TinyFishEngine {
  constructor(config) {
    this.client = new TinyFishWebAgentClient(config);
  }

  get defaults() {
    return this.client.getRunDefaults();
  }

  getPillars(targetUrl, domain) {
    return getInvestigationPillars(targetUrl, domain);
  }

  async runPillar(definition, { onEvent, extraGoal } = {}) {
    const params = buildAgentParams(definition, this.defaults, extraGoal);
    return this.client.runJson({ ...params, onEvent });
  }

  async queuePillar(definition, { extraGoal } = {}) {
    const params = buildAgentParams(definition, this.defaults, extraGoal);
    return this.client.runAsync(params);
  }

  async queueAllPillars(targetUrl, domain) {
    const definitions = listPillarDefinitions(targetUrl, domain);
    const results = await Promise.allSettled(
      definitions.map((def) => this.queuePillar(def))
    );
    const runIds = [];
    const errors = [];
    for (let i = 0; i < definitions.length; i++) {
      const pillar = definitions[i].pillar;
      const res = results[i];
      if (res.status === "fulfilled" && res.value?.run_id) {
        runIds.push({ pillar, run_id: res.value.run_id });
      } else {
        errors.push({
          pillar,
          message: res.status === "rejected" ? res.reason?.message : res.value?.error?.message || "queue failed",
        });
      }
    }
    return { runIds, errors, order: definitions.map((d) => d.pillar) };
  }

  async runBatchAllPillars(targetUrl, domain) {
    const definitions = listPillarDefinitions(targetUrl, domain);
    const runs = buildRunPayloads(definitions, this.defaults);
    return this.client.runBatchAsync(runs);
  }

  async getRunsBatch(runIds) {
    return this.client.getRunsBatch(runIds);
  }

  async search(query, options = {}) {
    return this.client.sdk.search.query({
      query,
      location: options.location || "US",
      language: options.language || "en",
      ...(options.recency_minutes ? { recency_minutes: options.recency_minutes } : {}),
    });
  }

  async fetchMarkdown(urls, options = {}) {
    const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
    if (list.length === 0) return { results: [], errors: [] };
    return this.client.sdk.fetch.getContents({
      urls: list,
      format: "markdown",
      ttl: options.ttl ?? 0,
      per_url_timeout_ms: options.perUrlTimeoutMs ?? 30000,
    });
  }

  formatSearchContext(results, limit = 6) {
    const items = Array.isArray(results) ? results.slice(0, limit) : [];
    if (items.length === 0) return "";
    return items
      .map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n   ${r.snippet}`)
      .join("\n");
  }

  formatFetchContext(fetchResponse, maxChars = 4000) {
    const page = fetchResponse?.results?.[0];
    if (!page?.text) return "";
    const header = `Fetched page: ${page.final_url || page.url}\nTitle: ${page.title || "unknown"}\n`;
    const body = String(page.text).slice(0, maxChars);
    return `${header}\n${body}`;
  }

  mapTinyFishEvent(event) {
    if (!event?.type) return null;
    switch (event.type) {
      case EventType.STARTED:
        return { kind: "started", runId: event.run_id, message: "TinyFish agent started" };
      case EventType.STREAMING_URL:
        return { kind: "streaming", runId: event.run_id, streamingUrl: event.streaming_url, message: "Live browser preview available" };
      case EventType.PROGRESS:
        return { kind: "progress", runId: event.run_id, message: event.purpose || "Agent working..." };
      case EventType.COMPLETE:
        return { kind: "complete", runId: event.run_id, message: "Agent run complete" };
      default:
        return null;
    }
  }
}
