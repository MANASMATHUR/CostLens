import {
  TinyFish,
  BrowserProfile,
  ProxyCountryCode,
  RunStatus,
  EventType,
  APIStatusError,
} from "@tiny-fish/sdk";

const TINYFISH_PROXY_COUNTRY_CODES = Object.values(ProxyCountryCode);

function mapProxyCountryCode(code) {
  if (!code) return null;
  const upper = String(code).toUpperCase();
  return TINYFISH_PROXY_COUNTRY_CODES.includes(upper) ? upper : null;
}

function mapBrowserProfile(profile) {
  if (!profile) return undefined;
  const normalized = String(profile).toLowerCase();
  if (normalized === BrowserProfile.STEALTH) return BrowserProfile.STEALTH;
  if (normalized === BrowserProfile.LITE) return BrowserProfile.LITE;
  return BrowserProfile.STEALTH;
}

export class TinyFishWebAgentClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || "";
    this.browserProfile = mapBrowserProfile(config.browserProfile) || BrowserProfile.STEALTH;
    const countryCode = mapProxyCountryCode(config.proxyCountryCode);
    this.defaultProxyConfig = config.proxyEnabled
      ? {
          enabled: true,
          ...(countryCode ? { country_code: countryCode } : {}),
        }
      : null;

    this.baseURL = (config.endpoint || "https://agent.tinyfish.ai").replace(/\/+$/, "");
    const sseTimeoutMs = Number(config.sseTimeoutMs) || 130000;
    const requestTimeoutMs = Number(config.requestTimeoutMs) || 120000;

    this.sseTimeoutMs = sseTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;

    this.client = new TinyFish({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
      timeout: Math.max(sseTimeoutMs, requestTimeoutMs),
      maxRetries: config.retryAttempts ?? 2,
    });
  }

  getRunDefaults() {
    return {
      browserProfile: this.browserProfile,
      proxyConfig: this.defaultProxyConfig,
    };
  }

  get sdk() {
    return this.client;
  }

  async runAutomation({ url, goal, browserProfile, proxyConfig, outputSchema, onEvent }) {
    const params = this._buildRunParams({ url, goal, browserProfile, proxyConfig, outputSchema });
    const stream = await this.client.agent.stream(params, this._streamCallbacks(onEvent));

    let lastComplete = null;
    const streamDeadline = Date.now() + this.sseTimeoutMs;

    try {
      for await (const event of stream) {
        if (Date.now() > streamDeadline) {
          await stream.close();
          throw new Error(`TinyFish stream timed out after ${this.sseTimeoutMs}ms`);
        }

        if (onEvent) onEvent(event);

        if (event.type === EventType.COMPLETE) {
          lastComplete = event;
        }
      }
    } catch (error) {
      throw this._wrapSdkError(error);
    }

    if (!lastComplete) {
      throw new Error("TinyFish stream ended without a COMPLETE event.");
    }

    const status = (lastComplete.status || RunStatus.COMPLETED).toUpperCase();
    if (status === RunStatus.FAILED || status === RunStatus.CANCELLED) {
      throw new Error(lastComplete.error?.message || "TinyFish automation failed.");
    }

    return lastComplete;
  }

  async runJson({ url, goal, browserProfile, proxyConfig, outputSchema, onEvent }) {
    const params = this._buildRunParams({ url, goal, browserProfile, proxyConfig, outputSchema });

    if (onEvent) {
      const completed = await this.runAutomation({ url, goal, browserProfile, proxyConfig, outputSchema, onEvent });
      return this._normalizeCompletePayload(completed);
    }

    try {
      const response = await this.client.agent.run(params);
      if (response.status === RunStatus.FAILED || response.status === RunStatus.CANCELLED) {
        throw new Error(response.error?.message || "TinyFish automation failed.");
      }
      return {
        runId: response.run_id,
        status: response.status,
        result: response.result,
      };
    } catch (error) {
      throw this._wrapSdkError(error);
    }
  }

  async runSync({ url, goal, browserProfile, proxyConfig, outputSchema }) {
    const params = this._buildRunParams({ url, goal, browserProfile, proxyConfig, outputSchema });
    try {
      const response = await this.client.agent.run(params);
      if (response.status === RunStatus.FAILED || response.status === RunStatus.CANCELLED) {
        throw new Error(response.error?.message || "TinyFish automation failed.");
      }
      return response;
    } catch (error) {
      throw this._wrapSdkError(error);
    }
  }

  async runAsync({ url, goal, browserProfile, proxyConfig, outputSchema }) {
    const params = this._buildRunParams({ url, goal, browserProfile, proxyConfig, outputSchema });
    try {
      return await this.client.agent.queue(params);
    } catch (error) {
      throw this._wrapSdkError(error);
    }
  }

  /** POST /v1/automation/run-batch */
  async runBatchAsync(runs) {
    if (!Array.isArray(runs) || runs.length === 0) {
      throw new Error("runBatchAsync requires a non-empty runs array.");
    }
    const normalized = runs.map((run) => {
      const payload = {
        url: run.url,
        goal: run.goal,
        browser_profile: mapBrowserProfile(run.browser_profile || run.browserProfile) || this.browserProfile,
      };
      const proxy = run.proxy_config || run.proxyConfig || this.defaultProxyConfig;
      if (proxy) payload.proxy_config = proxy;
      const schema = run.output_schema || run.outputSchema;
      if (schema) payload.output_schema = schema;
      return payload;
    });
    try {
      return await this._postJson("/v1/automation/run-batch", { runs: normalized });
    } catch (error) {
      throw this._wrapSdkError(error);
    }
  }

  async getRun(runId) {
    if (!runId) {
      throw new Error("runId is required for getRun.");
    }
    try {
      const run = await this.client.runs.get(runId);
      return {
        run_id: run.run_id,
        status: run.status,
        result: run.result,
        error: run.error,
      };
    } catch (error) {
      throw this._wrapSdkError(error);
    }
  }

  /** POST /v1/runs/batch */
  async getRunsBatch(runIds) {
    const ids = (Array.isArray(runIds) ? runIds : []).filter(Boolean);
    if (ids.length === 0) {
      return { data: [], not_found: [] };
    }
    try {
      return await this._postJson("/v1/runs/batch", { run_ids: ids });
    } catch (error) {
      throw this._wrapSdkError(error);
    }
  }

  _buildRunParams({ url, goal, browserProfile, proxyConfig, outputSchema }) {
    const proxy = proxyConfig ?? this.defaultProxyConfig;
    return {
      url,
      goal,
      browser_profile: mapBrowserProfile(browserProfile) || this.browserProfile,
      ...(proxy ? { proxy_config: proxy } : {}),
      ...(outputSchema ? { output_schema: outputSchema } : {}),
    };
  }

  _streamCallbacks(onEvent) {
    if (!onEvent) return undefined;
    return {
      onStarted: (event) => onEvent(event),
      onStreamingUrl: (event) => onEvent(event),
      onProgress: (event) => onEvent(event),
      onHeartbeat: (event) => onEvent(event),
      onComplete: (event) => onEvent(event),
    };
  }

  _normalizeCompletePayload(event) {
    const resultJson = event.resultJson ?? event.result ?? event.output ?? null;
    if (!resultJson) {
      return {
        runId: event.runId || event.run_id || null,
        status: event.status || RunStatus.COMPLETED,
        result: null,
      };
    }

    let normalized = resultJson;
    if (typeof normalized === "string") {
      try {
        normalized = JSON.parse(normalized);
      } catch {
        normalized = { raw: resultJson };
      }
    }

    return {
      runId: event.runId || event.run_id || null,
      status: event.status || RunStatus.COMPLETED,
      result: normalized,
    };
  }

  async _postJson(path, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await fetch(`${this.baseURL}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const bodyText = await response.text().catch(() => "");
      let payload = null;
      if (bodyText) {
        try {
          payload = JSON.parse(bodyText);
        } catch {
          payload = { raw: bodyText };
        }
      }

      if (!response.ok) {
        const message = payload?.error?.message || bodyText || "request failed";
        const error = new Error(`TinyFish ${response.status}: ${message}`);
        error.statusCode = response.status;
        throw error;
      }

      return payload;
    } catch (error) {
      if (error?.name === "AbortError") {
        const timeoutError = new Error(`TinyFish request timed out after ${this.requestTimeoutMs}ms`);
        timeoutError.code = "ETIMEDOUT";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  _wrapSdkError(error) {
    if (error instanceof APIStatusError) {
      const wrapped = new Error(`TinyFish ${error.statusCode}: ${error.message}`);
      wrapped.statusCode = error.statusCode;
      return wrapped;
    }
    return error;
  }
}
