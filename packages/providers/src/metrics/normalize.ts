import { classifyFreshness, type Diagnostic, type EvidenceState } from "@observability-gate/core";
import type {
  CanonicalMetricIdentity,
  MetricIdentityLabels,
  MetricMatrix,
  MetricSample,
  MetricSeries,
  MetricVector
} from "./types.js";

interface NormalizationInput {
  readonly payload: unknown;
  readonly acquiredAt: string;
  readonly minimumSamples: number;
  readonly maximumAgeMs: number;
  readonly maximumFutureSkewMs: number;
  readonly identityLabels: MetricIdentityLabels;
  readonly range?: { readonly start: string; readonly end: string; readonly stepMs: number };
}

export interface NormalizedMetrics<T extends MetricVector | MetricMatrix> {
  readonly state: EvidenceState;
  readonly observedAt?: string;
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): NormalizedMetrics<MetricVector | MetricMatrix> {
  return {
    state: "invalid",
    diagnostics: [
      {
        code: "EVIDENCE_INVALID",
        message,
        retryable: false
      }
    ]
  };
}

function parseLabels(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    return undefined;
  }
  return Object.freeze({ ...(value as Record<string, string>) });
}

function identity(
  labels: Readonly<Record<string, string>>,
  mapping: MetricIdentityLabels
): CanonicalMetricIdentity {
  const result: {
    serviceName?: string;
    serviceNamespace?: string;
    serviceVersion?: string;
    deploymentEnvironment?: string;
    serviceInstanceId?: string;
  } = {};
  for (const key of [
    "serviceName",
    "serviceNamespace",
    "serviceVersion",
    "deploymentEnvironment",
    "serviceInstanceId"
  ] as const) {
    const label = mapping[key];
    if (label !== undefined && labels[label] !== undefined) {
      result[key] = labels[label];
    }
  }
  return Object.freeze(result);
}

function parseTuple(
  value: unknown
): { readonly value: number; readonly observedAt: string } | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }
  const timestamp = typeof value[0] === "number" ? value[0] : Number.NaN;
  const numericValue =
    typeof value[1] === "string" || typeof value[1] === "number" ? Number(value[1]) : Number.NaN;
  if (!Number.isFinite(timestamp) || !Number.isFinite(numericValue)) {
    return undefined;
  }
  const observedAt = new Date(timestamp * 1000);
  if (!Number.isFinite(observedAt.getTime())) {
    return undefined;
  }
  return Object.freeze({ value: numericValue, observedAt: observedAt.toISOString() });
}

function parseWarnings(payload: Record<string, unknown>): readonly string[] | undefined {
  if (payload.warnings === undefined) {
    return Object.freeze([]);
  }
  if (
    !Array.isArray(payload.warnings) ||
    payload.warnings.some((item) => typeof item !== "string")
  ) {
    return undefined;
  }
  return Object.freeze([...payload.warnings] as string[]);
}

function warningDiagnostics(warnings: readonly string[]): readonly Diagnostic[] {
  return Object.freeze(
    warnings.map((message) =>
      Object.freeze({ code: "PROVIDER_PROTOCOL", message, retryable: false })
    )
  );
}

function stateFor(
  observedAt: string | undefined,
  acquiredAt: string,
  sampleCount: number,
  input: Pick<NormalizationInput, "maximumAgeMs" | "maximumFutureSkewMs" | "minimumSamples">
): EvidenceState {
  if (observedAt === undefined) {
    return sampleCount === 0 ? "missing" : "invalid";
  }
  return classifyFreshness({
    observedAt,
    acquiredAt,
    sampleCount,
    minimumSamples: input.minimumSamples,
    maximumAgeMs: input.maximumAgeMs,
    maximumFutureSkewMs: input.maximumFutureSkewMs
  });
}

function latestTimestamp(samples: readonly { readonly observedAt: string }[]): string | undefined {
  return samples.reduce<string | undefined>(
    (latest, sample) =>
      latest === undefined || sample.observedAt > latest ? sample.observedAt : latest,
    undefined
  );
}

export function normalizePrometheusResponse(
  input: NormalizationInput
): NormalizedMetrics<MetricVector | MetricMatrix> {
  if (
    !isRecord(input.payload) ||
    input.payload.status !== "success" ||
    !isRecord(input.payload.data)
  ) {
    return invalid("Prometheus returned an invalid response envelope");
  }
  const warnings = parseWarnings(input.payload);
  if (warnings === undefined) {
    return invalid("Prometheus returned malformed warnings");
  }
  const diagnostics = warningDiagnostics(warnings);
  const data = input.payload.data;

  if (data.resultType === "scalar") {
    const tuple = parseTuple(data.result);
    if (tuple === undefined || input.range !== undefined) {
      return invalid("Prometheus returned a malformed scalar result");
    }
    const sample: MetricSample = Object.freeze({
      labels: Object.freeze({}),
      identity: Object.freeze({}),
      ...tuple
    });
    const value: MetricVector = Object.freeze({
      resultType: "vector",
      samples: Object.freeze([sample]),
      sampleCount: 1,
      queryTime: input.acquiredAt,
      warnings
    });
    return {
      state: stateFor(tuple.observedAt, input.acquiredAt, 1, input),
      observedAt: tuple.observedAt,
      value,
      diagnostics
    };
  }

  if (!Array.isArray(data.result)) {
    return invalid("Prometheus result is not an array");
  }

  if (data.resultType === "vector" && input.range === undefined) {
    const samples: MetricSample[] = [];
    for (const item of data.result) {
      if (!isRecord(item)) {
        return invalid("Prometheus vector item is malformed");
      }
      const labels = parseLabels(item.metric);
      const tuple = parseTuple(item.value);
      if (labels === undefined || tuple === undefined) {
        return invalid("Prometheus vector sample is malformed or non-finite");
      }
      samples.push(
        Object.freeze({ labels, identity: identity(labels, input.identityLabels), ...tuple })
      );
    }
    const observedAt = latestTimestamp(samples);
    const value: MetricVector = Object.freeze({
      resultType: "vector",
      samples: Object.freeze(samples),
      sampleCount: samples.length,
      queryTime: input.acquiredAt,
      warnings
    });
    return {
      state: stateFor(observedAt, input.acquiredAt, samples.length, input),
      ...(observedAt === undefined ? {} : { observedAt }),
      value,
      diagnostics
    };
  }

  if (data.resultType === "matrix" && input.range !== undefined) {
    const series: MetricSeries[] = [];
    const allSamples: { readonly value: number; readonly observedAt: string }[] = [];
    for (const item of data.result) {
      if (!isRecord(item) || !Array.isArray(item.values)) {
        return invalid("Prometheus matrix item is malformed");
      }
      const labels = parseLabels(item.metric);
      if (labels === undefined) {
        return invalid("Prometheus matrix labels are malformed");
      }
      const samples = item.values.map(parseTuple);
      if (samples.some((sample) => sample === undefined)) {
        return invalid("Prometheus matrix sample is malformed or non-finite");
      }
      const typedSamples = samples as { readonly value: number; readonly observedAt: string }[];
      allSamples.push(...typedSamples);
      series.push(
        Object.freeze({
          labels,
          identity: identity(labels, input.identityLabels),
          samples: Object.freeze(typedSamples)
        })
      );
    }
    const observedAt = latestTimestamp(allSamples);
    const value: MetricMatrix = Object.freeze({
      resultType: "matrix",
      series: Object.freeze(series),
      sampleCount: allSamples.length,
      queryTime: input.acquiredAt,
      range: Object.freeze(input.range),
      warnings
    });
    return {
      state: stateFor(observedAt, input.acquiredAt, allSamples.length, input),
      ...(observedAt === undefined ? {} : { observedAt }),
      value,
      diagnostics
    };
  }

  return invalid("Prometheus result type does not match the requested query");
}
