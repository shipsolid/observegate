import {
  GateError,
  classifyFreshness,
  fingerprintQuery,
  stableFingerprint,
  type Diagnostic,
  type Evidence,
  type EvidenceState
} from "@observability-gate/core";
import type { CanonicalMetricIdentity } from "../metrics/types.js";
import type { TransportRequest } from "../transport/guarded-fetch.js";
import type {
  TempoSearchRequest,
  TempoTransport,
  TraceSearchEvidence,
  TraceSpanSummary,
  TraceSummary,
  TracesProvider
} from "./types.js";

export interface TempoClientOptions {
  readonly endpoint: string;
  readonly provider: string;
  readonly transport: TempoTransport;
  readonly maximumLimit: number;
  readonly maximumRangeMs: number;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly headers?: HeadersInit;
  readonly clock?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nanosecondsTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    return undefined;
  }
  try {
    const date = new Date(Number(BigInt(value) / 1_000_000n));
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function traceQlString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

function canonicalIdentity(resource: unknown): CanonicalMetricIdentity | undefined {
  if (!isRecord(resource)) {
    return undefined;
  }
  const result: {
    serviceName?: string;
    serviceNamespace?: string;
    serviceVersion?: string;
    deploymentEnvironment?: string;
  } = {};
  const mapping = {
    serviceName: "service.name",
    serviceNamespace: "service.namespace",
    serviceVersion: "service.version",
    deploymentEnvironment: "deployment.environment.name"
  } as const;
  for (const [key, attribute] of Object.entries(mapping) as [keyof typeof mapping, string][]) {
    const value = resource[attribute];
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

export class TempoClient implements TracesProvider {
  private readonly endpoint: URL;
  private readonly options: TempoClientOptions;
  private readonly clock: () => number;

  public constructor(options: TempoClientOptions) {
    this.endpoint = new URL(
      options.endpoint.endsWith("/") ? options.endpoint : `${options.endpoint}/`
    );
    this.options = options;
    this.clock = options.clock ?? Date.now;
  }

  public async search(request: TempoSearchRequest): Promise<Evidence<TraceSearchEvidence>> {
    const { startMs, endMs } = this.validate(request);
    const query = this.buildQuery(request);
    const limit = Math.min(request.limit, this.options.maximumLimit);
    const acquiredAt = new Date(this.clock()).toISOString();
    const queryFingerprint = fingerprintQuery(query);
    const base = {
      id: stableFingerprint({
        provider: this.options.provider,
        capability: "traces.search",
        target: request.target,
        queryFingerprint,
        acquiredAt
      }),
      kind: "traces.summaries",
      source: Object.freeze({
        provider: this.options.provider,
        capability: "traces.search",
        queryFingerprint
      }),
      target: request.target,
      acquiredAt
    };

    let payload: unknown;
    try {
      payload = (
        await this.options.transport.request(
          this.transportRequest(request, query, startMs, endMs, limit)
        )
      ).data;
    } catch (error) {
      const gateError =
        error instanceof GateError
          ? error
          : new GateError({
              code: "PROVIDER_UNAVAILABLE",
              safeMessage: "Tempo request failed",
              retryable: true,
              cause: error
            });
      if (gateError.code === "CANCELLED") {
        throw gateError;
      }
      return Object.freeze({
        ...base,
        state: gateError.code === "PROVIDER_PROTOCOL" ? "invalid" : "unavailable",
        diagnostics: Object.freeze([gateError.toDiagnostic()])
      });
    }

    return Object.freeze({
      ...base,
      ...this.normalize(payload, request, acquiredAt, limit)
    });
  }

  private validate(request: TempoSearchRequest): { startMs: number; endMs: number } {
    const startMs = Date.parse(request.start);
    const endMs = Date.parse(request.end);
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs ||
      endMs - startMs > this.options.maximumRangeMs ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.samplingProbability <= 0 ||
      request.samplingProbability > 1
    ) {
      throw new GateError({
        code: "SECURITY_POLICY",
        safeMessage: "Tempo search bounds are outside the configured limits",
        retryable: false
      });
    }
    return { startMs, endMs };
  }

  private buildQuery(request: TempoSearchRequest): string {
    const clauses = [`resource.service.name = ${traceQlString(request.service.name)}`];
    if (request.service.namespace !== undefined) {
      clauses.push(`resource.service.namespace = ${traceQlString(request.service.namespace)}`);
    }
    if (request.service.version !== undefined) {
      clauses.push(`resource.service.version = ${traceQlString(request.service.version)}`);
    }
    if (request.service.environment !== undefined) {
      clauses.push(
        `resource.deployment.environment.name = ${traceQlString(request.service.environment)}`
      );
    }
    return `{ ${clauses.join(" && ")} }`;
  }

  private normalize(
    payload: unknown,
    request: TempoSearchRequest,
    acquiredAt: string,
    limit: number
  ): {
    state: EvidenceState;
    observedAt?: string;
    value?: TraceSearchEvidence;
    diagnostics: readonly Diagnostic[];
  } {
    if (!isRecord(payload) || !Array.isArray(payload.traces)) {
      return this.invalid("Tempo returned an invalid search envelope");
    }
    const warnings =
      payload.warnings === undefined
        ? []
        : Array.isArray(payload.warnings) &&
            payload.warnings.every((item) => typeof item === "string")
          ? (payload.warnings as string[])
          : undefined;
    if (warnings === undefined) {
      return this.invalid("Tempo returned malformed warnings");
    }

    const traces: TraceSummary[] = [];
    for (const value of payload.traces) {
      const trace = this.parseTrace(value);
      if (trace === undefined) {
        return this.invalid("Tempo returned malformed trace evidence");
      }
      traces.push(trace);
    }
    const observedAt = traces.reduce<string | undefined>(
      (latest, trace) =>
        latest === undefined || trace.observedAt > latest ? trace.observedAt : latest,
      undefined
    );
    let state: EvidenceState;
    if (observedAt === undefined) {
      state =
        request.trafficObserved && request.samplingProbability < 1 ? "insufficient" : "missing";
    } else {
      state = classifyFreshness({
        observedAt,
        acquiredAt,
        sampleCount: traces.length,
        minimumSamples: request.minimumTraces,
        maximumAgeMs: request.maximumAgeMs,
        maximumFutureSkewMs: request.maximumFutureSkewMs
      });
    }
    const diagnostics = Object.freeze(
      warnings.map((message) => ({ code: "PROVIDER_PROTOCOL", message, retryable: false }))
    );
    const result: TraceSearchEvidence = Object.freeze({
      traces: Object.freeze(traces),
      traceCount: traces.length,
      range: Object.freeze({ start: request.start, end: request.end, limit }),
      warnings: Object.freeze(warnings)
    });
    return {
      state,
      ...(observedAt === undefined ? {} : { observedAt }),
      value: result,
      diagnostics
    };
  }

  private parseTrace(value: unknown): TraceSummary | undefined {
    if (!isRecord(value) || typeof value.traceID !== "string") {
      return undefined;
    }
    const observedAt = nanosecondsTimestamp(value.startTimeUnixNano);
    const durationMs = finiteNumber(value.durationMs);
    const identity = canonicalIdentity(value.resource);
    if (observedAt === undefined || durationMs === undefined || identity === undefined) {
      return undefined;
    }
    if (value.spans !== undefined && !Array.isArray(value.spans)) {
      return undefined;
    }
    const spans: TraceSpanSummary[] = [];
    for (const spanValue of value.spans ?? []) {
      const span = this.parseSpan(spanValue);
      if (span === undefined) {
        return undefined;
      }
      spans.push(span);
    }
    const rootServiceName = optionalString(value.rootServiceName);
    const rootTraceName = optionalString(value.rootTraceName);
    return Object.freeze({
      traceId: value.traceID,
      ...(rootServiceName === undefined ? {} : { rootServiceName }),
      ...(rootTraceName === undefined ? {} : { rootTraceName }),
      observedAt,
      durationMs,
      partial: value.partial === true,
      identity,
      spans: Object.freeze(spans)
    });
  }

  private parseSpan(value: unknown): TraceSpanSummary | undefined {
    if (!isRecord(value) || typeof value.spanID !== "string" || typeof value.name !== "string") {
      return undefined;
    }
    const resource = isRecord(value.resource) ? value.resource : {};
    const attributes = isRecord(value.attributes) ? value.attributes : {};
    const durationMs = value.durationMs === undefined ? undefined : finiteNumber(value.durationMs);
    if (value.durationMs !== undefined && durationMs === undefined) {
      return undefined;
    }
    const parentSpanId = optionalString(value.parentSpanID);
    const kind = optionalString(value.kind);
    const status = optionalString(value.status);
    const serviceName = optionalString(resource["service.name"]);
    const peerService = optionalString(attributes["peer.service"]);
    return Object.freeze({
      spanId: value.spanID,
      ...(parentSpanId === undefined ? {} : { parentSpanId }),
      name: value.name,
      ...(kind === undefined ? {} : { kind }),
      ...(status === undefined ? {} : { status }),
      ...(serviceName === undefined ? {} : { serviceName }),
      ...(peerService === undefined ? {} : { peerService }),
      ...(durationMs === undefined ? {} : { durationMs })
    });
  }

  private invalid(message: string): { state: "invalid"; diagnostics: readonly Diagnostic[] } {
    return {
      state: "invalid",
      diagnostics: Object.freeze([{ code: "EVIDENCE_INVALID", message, retryable: false }])
    };
  }

  private transportRequest(
    request: TempoSearchRequest,
    query: string,
    startMs: number,
    endMs: number,
    limit: number
  ): TransportRequest {
    const url = new URL("api/search", this.endpoint);
    url.search = new URLSearchParams({
      q: query,
      start: String(Math.floor(startMs / 1000)),
      end: String(Math.floor(endMs / 1000)),
      limit: String(limit)
    }).toString();
    return {
      url,
      kind: "provider",
      headers: this.options.headers ?? {},
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maximumResponseBytes: this.options.maximumResponseBytes ?? 2 * 1024 * 1024,
      retry: {
        attempts: 3,
        initialBackoffMs: 200,
        maximumBackoffMs: 2_000,
        retryStatuses: [429, 502, 503, 504]
      },
      signal: request.signal ?? new AbortController().signal,
      ...(request.deadlineAtMs === undefined ? {} : { deadlineAtMs: request.deadlineAtMs })
    };
  }
}
