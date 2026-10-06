import type { Evidence, EvidenceRange } from "@observability-gate/core";
import type { TransportRequest, TransportResponse } from "../transport/guarded-fetch.js";

export interface CanonicalMetricIdentity {
  readonly serviceName?: string;
  readonly serviceNamespace?: string;
  readonly serviceVersion?: string;
  readonly deploymentEnvironment?: string;
  readonly serviceInstanceId?: string;
}

export interface MetricIdentityLabels {
  readonly serviceName?: string;
  readonly serviceNamespace?: string;
  readonly serviceVersion?: string;
  readonly deploymentEnvironment?: string;
  readonly serviceInstanceId?: string;
}

export interface MetricSample {
  readonly labels: Readonly<Record<string, string>>;
  readonly identity: CanonicalMetricIdentity;
  readonly value: number;
  readonly observedAt: string;
}

export interface MetricVector {
  readonly resultType: "vector";
  readonly samples: readonly MetricSample[];
  readonly sampleCount: number;
  readonly queryTime: string;
  readonly warnings: readonly string[];
}

export interface MetricSeries {
  readonly labels: Readonly<Record<string, string>>;
  readonly identity: CanonicalMetricIdentity;
  readonly samples: readonly Omit<MetricSample, "labels" | "identity">[];
}

export interface MetricMatrix {
  readonly resultType: "matrix";
  readonly series: readonly MetricSeries[];
  readonly sampleCount: number;
  readonly queryTime: string;
  readonly range: Required<Pick<EvidenceRange, "start" | "end" | "stepMs">>;
  readonly warnings: readonly string[];
}

export interface MetricQueryBase {
  readonly query: string;
  readonly target: string;
  readonly releaseId?: string;
  readonly minimumSamples: number;
  readonly maximumAgeMs: number;
  readonly maximumFutureSkewMs: number;
  readonly requireProductionScope?: boolean;
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
}

export interface MetricInstantQuery extends MetricQueryBase {
  readonly time?: string;
}

export interface MetricRangeQuery extends MetricQueryBase {
  readonly start: string;
  readonly end: string;
  readonly stepMs: number;
}

export interface MetricsProvider {
  queryInstant(request: MetricInstantQuery): Promise<Evidence<MetricVector>>;
  queryRange(request: MetricRangeQuery): Promise<Evidence<MetricMatrix>>;
}

export interface MetricsTransport {
  request(request: TransportRequest): Promise<TransportResponse>;
}
