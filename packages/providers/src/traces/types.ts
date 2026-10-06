import type { Evidence } from "@observability-gate/core";
import type { CanonicalMetricIdentity, MetricsTransport } from "../metrics/types.js";

export interface TraceSpanSummary {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind?: string;
  readonly status?: string;
  readonly serviceName?: string;
  readonly peerService?: string;
  readonly durationMs?: number;
}

export interface TraceSummary {
  readonly traceId: string;
  readonly rootServiceName?: string;
  readonly rootTraceName?: string;
  readonly observedAt: string;
  readonly durationMs: number;
  readonly partial: boolean;
  readonly identity: CanonicalMetricIdentity;
  readonly spans: readonly TraceSpanSummary[];
}

export interface TraceSearchEvidence {
  readonly traces: readonly TraceSummary[];
  readonly traceCount: number;
  readonly range: { readonly start: string; readonly end: string; readonly limit: number };
  readonly warnings: readonly string[];
}

export interface TempoServiceIdentity {
  readonly name: string;
  readonly namespace?: string;
  readonly version?: string;
  readonly environment?: string;
}

export interface TempoSearchRequest {
  readonly target: string;
  readonly service: TempoServiceIdentity;
  readonly start: string;
  readonly end: string;
  readonly limit: number;
  readonly minimumTraces: number;
  readonly maximumAgeMs: number;
  readonly maximumFutureSkewMs: number;
  readonly trafficObserved: boolean;
  readonly samplingProbability: number;
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
}

export interface TracesProvider {
  search(request: TempoSearchRequest): Promise<Evidence<TraceSearchEvidence>>;
}

export type TempoTransport = MetricsTransport;
