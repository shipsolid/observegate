import {
  GateError,
  fingerprintQuery,
  stableFingerprint,
  type Evidence,
  type EvidenceState
} from "@observability-gate/core";
import type { TransportRequest } from "../transport/guarded-fetch.js";
import { normalizePrometheusResponse } from "./normalize.js";
import { guardPrometheusQuery } from "./query-guard.js";
import type {
  MetricIdentityLabels,
  MetricInstantQuery,
  MetricMatrix,
  MetricRangeQuery,
  MetricsProvider,
  MetricsTransport,
  MetricVector
} from "./types.js";

export interface PrometheusMetricsProviderOptions {
  readonly endpoint: string;
  readonly provider: string;
  readonly transport: MetricsTransport;
  readonly identityLabels?: MetricIdentityLabels;
  readonly maximumQueryLength?: number;
  readonly maximumRangeMs: number;
  readonly minimumStepMs?: number;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly headers?: HeadersInit;
  readonly clock?: () => number;
}

function failureState(error: GateError): EvidenceState {
  return error.code === "PROVIDER_PROTOCOL" || error.code === "EVIDENCE_INVALID"
    ? "invalid"
    : "unavailable";
}

function isGateError(error: unknown): error is GateError {
  return error instanceof GateError;
}

export class PrometheusMetricsProvider implements MetricsProvider {
  private readonly endpoint: URL;
  private readonly options: PrometheusMetricsProviderOptions;
  private readonly clock: () => number;

  public constructor(options: PrometheusMetricsProviderOptions) {
    this.endpoint = new URL(
      options.endpoint.endsWith("/") ? options.endpoint : `${options.endpoint}/`
    );
    this.options = options;
    this.clock = options.clock ?? Date.now;
  }

  public queryInstant(request: MetricInstantQuery): Promise<Evidence<MetricVector>> {
    guardPrometheusQuery({
      query: request.query,
      ...(this.options.maximumQueryLength === undefined
        ? {}
        : { maximumQueryLength: this.options.maximumQueryLength }),
      ...(request.requireProductionScope
        ? { requiredScopeLabels: this.productionScopeLabels() }
        : {})
    });
    const parameters = new URLSearchParams({ query: request.query });
    if (request.time !== undefined) {
      parameters.set("time", this.timestampSeconds(request.time));
    }
    return this.execute<MetricVector>(request, "query", parameters, "metrics.vector");
  }

  public queryRange(request: MetricRangeQuery): Promise<Evidence<MetricMatrix>> {
    const startMs = Date.parse(request.start);
    const endMs = Date.parse(request.end);
    guardPrometheusQuery({
      query: request.query,
      ...(this.options.maximumQueryLength === undefined
        ? {}
        : { maximumQueryLength: this.options.maximumQueryLength }),
      startMs,
      endMs,
      maximumRangeMs: this.options.maximumRangeMs,
      stepMs: request.stepMs,
      ...(this.options.minimumStepMs === undefined
        ? {}
        : { minimumStepMs: this.options.minimumStepMs }),
      ...(request.requireProductionScope
        ? { requiredScopeLabels: this.productionScopeLabels() }
        : {})
    });
    const parameters = new URLSearchParams({
      query: request.query,
      start: String(startMs / 1000),
      end: String(endMs / 1000),
      step: String(request.stepMs / 1000)
    });
    return this.execute<MetricMatrix>(request, "query_range", parameters, "metrics.matrix", {
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      stepMs: request.stepMs
    });
  }

  private productionScopeLabels(): readonly string[] {
    const serviceName = this.options.identityLabels?.serviceName;
    const deploymentEnvironment = this.options.identityLabels?.deploymentEnvironment;
    if (serviceName === undefined || deploymentEnvironment === undefined) {
      throw new GateError({
        code: "CONFIG_SCHEMA",
        safeMessage: "Production metrics queries require service and environment label mappings",
        retryable: false
      });
    }
    return [serviceName, deploymentEnvironment];
  }

  private timestampSeconds(value: string): string {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw new GateError({
        code: "CONFIG_SCHEMA",
        safeMessage: "Prometheus query timestamp is invalid",
        retryable: false
      });
    }
    return String(parsed / 1000);
  }

  private async execute<T extends MetricVector | MetricMatrix>(
    request: MetricInstantQuery | MetricRangeQuery,
    apiMethod: "query" | "query_range",
    parameters: URLSearchParams,
    kind: string,
    range?: { readonly start: string; readonly end: string; readonly stepMs: number }
  ): Promise<Evidence<T>> {
    const acquiredAt = new Date(this.clock()).toISOString();
    const queryFingerprint = fingerprintQuery(request.query);
    const source = Object.freeze({
      provider: this.options.provider,
      capability: apiMethod === "query" ? "metrics.query.instant" : "metrics.query.range",
      queryFingerprint
    });
    const base = {
      id: stableFingerprint({
        provider: this.options.provider,
        capability: source.capability,
        target: request.target,
        queryFingerprint,
        acquiredAt
      }),
      kind,
      source,
      target: request.target,
      ...(request.releaseId === undefined ? {} : { releaseId: request.releaseId }),
      acquiredAt
    };

    let payload: unknown;
    try {
      const transportRequest = this.transportRequest(request, apiMethod, parameters);
      payload = (await this.options.transport.request(transportRequest)).data;
    } catch (error) {
      if (isGateError(error) && error.code === "CANCELLED") {
        throw error;
      }
      const gateError = isGateError(error)
        ? error
        : new GateError({
            code: "PROVIDER_UNAVAILABLE",
            safeMessage: "Prometheus request failed",
            retryable: true,
            cause: error
          });
      return Object.freeze({
        ...base,
        state: failureState(gateError),
        diagnostics: Object.freeze([gateError.toDiagnostic()])
      });
    }

    const normalized = normalizePrometheusResponse({
      payload,
      acquiredAt,
      minimumSamples: request.minimumSamples,
      maximumAgeMs: request.maximumAgeMs,
      maximumFutureSkewMs: request.maximumFutureSkewMs,
      identityLabels: this.options.identityLabels ?? {},
      ...(range === undefined ? {} : { range })
    });
    return Object.freeze({
      ...base,
      state: normalized.state,
      ...(normalized.observedAt === undefined ? {} : { observedAt: normalized.observedAt }),
      ...(normalized.value === undefined ? {} : { value: normalized.value as T }),
      diagnostics: normalized.diagnostics
    });
  }

  private transportRequest(
    request: MetricInstantQuery | MetricRangeQuery,
    apiMethod: "query" | "query_range",
    parameters: URLSearchParams
  ): TransportRequest {
    const url = new URL(`api/v1/${apiMethod}`, this.endpoint);
    const encodedUrl = new URL(url);
    encodedUrl.search = parameters.toString();
    const usePost = encodedUrl.toString().length > 4 * 1024;
    const headers = new Headers(this.options.headers);
    if (usePost) {
      headers.set("content-type", "application/x-www-form-urlencoded");
    }

    const signal = request.signal ?? new AbortController().signal;
    return {
      url: usePost ? url : encodedUrl,
      kind: "provider",
      method: usePost ? "POST" : "GET",
      headers: Object.fromEntries(headers.entries()),
      ...(usePost ? { body: parameters } : {}),
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maximumResponseBytes: this.options.maximumResponseBytes ?? 2 * 1024 * 1024,
      retry: {
        attempts: 3,
        initialBackoffMs: 200,
        maximumBackoffMs: 2_000,
        retryStatuses: [429, 502, 503, 504]
      },
      signal,
      ...(request.deadlineAtMs === undefined ? {} : { deadlineAtMs: request.deadlineAtMs })
    };
  }
}
