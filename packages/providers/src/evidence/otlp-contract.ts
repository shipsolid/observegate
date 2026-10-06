import { GateError } from "@observability-gate/core";
import { validateProvenance, type ExpectedProvenance } from "./provenance.js";

export interface OtlpContractEvidence {
  readonly resource: {
    readonly serviceName: string;
    readonly serviceNamespace: string;
    readonly serviceVersion: string;
    readonly deploymentEnvironment: string;
  };
  readonly metricCount: number;
  readonly logCount: number;
  readonly traceCount: number;
  readonly correlatedLogCount: number;
  readonly errorSpanCount: number;
  readonly routes: readonly string[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function invalid(message: string): never {
  throw new GateError({ code: "EVIDENCE_INVALID", safeMessage: message, retryable: false });
}

function rejectForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectForbiddenKeys);
    return;
  }
  const object = record(value);
  if (object === undefined) return;
  for (const [key, nested] of Object.entries(object)) {
    if (
      /(?:request|user)[._-]?id|raw[._-]?timestamp|password|secret|token|cookie|authorization/iu.test(
        key
      )
    ) {
      invalid("OTLP contract contains a forbidden cardinality or sensitive field");
    }
    rejectForbiddenKeys(nested);
  }
}

export function parseOtlpContract(
  content: Buffer,
  expectedProvenance: ExpectedProvenance
): OtlpContractEvidence {
  let payload: unknown;
  try {
    payload = JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    return invalid("OTLP contract is not valid JSON");
  }
  rejectForbiddenKeys(payload);
  const root = record(payload);
  const resource = record(root?.resource);
  if (
    root === undefined ||
    resource === undefined ||
    typeof resource["service.name"] !== "string" ||
    typeof resource["service.namespace"] !== "string" ||
    typeof resource["service.version"] !== "string" ||
    typeof resource["deployment.environment.name"] !== "string" ||
    !Array.isArray(root.metrics) ||
    !Array.isArray(root.logs) ||
    !Array.isArray(root.traces)
  ) {
    return invalid("OTLP contract is missing required signals or resource identity");
  }
  validateProvenance(root.provenance, expectedProvenance);
  const traceIds = new Set<string>();
  const routes = new Set<string>();
  let errorSpanCount = 0;
  for (const rawTrace of root.traces) {
    const trace = record(rawTrace);
    if (typeof trace?.traceId !== "string" || !Array.isArray(trace.spans)) {
      return invalid("OTLP trace contract is invalid");
    }
    traceIds.add(trace.traceId);
    for (const rawSpan of trace.spans) {
      const span = record(rawSpan);
      const attributes = record(span?.attributes);
      if (span === undefined || attributes === undefined) return invalid("OTLP span is invalid");
      if (span.status === "ERROR") errorSpanCount += 1;
      const route = attributes["http.route"];
      if (typeof route === "string") {
        if (
          !route.startsWith("/") ||
          /\/(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,})(?:\/|$)/iu.test(route)
        ) {
          return invalid("OTLP HTTP route is not normalized");
        }
        routes.add(route);
      }
    }
  }
  let correlatedLogCount = 0;
  for (const rawLog of root.logs) {
    const log = record(rawLog);
    if (log === undefined) return invalid("OTLP log contract is invalid");
    if (typeof log.traceId === "string" && traceIds.has(log.traceId)) correlatedLogCount += 1;
  }
  for (const rawMetric of root.metrics) {
    if (typeof record(rawMetric)?.name !== "string")
      return invalid("OTLP metric contract is invalid");
  }
  return Object.freeze({
    resource: Object.freeze({
      serviceName: resource["service.name"],
      serviceNamespace: resource["service.namespace"],
      serviceVersion: resource["service.version"],
      deploymentEnvironment: resource["deployment.environment.name"]
    }),
    metricCount: root.metrics.length,
    logCount: root.logs.length,
    traceCount: root.traces.length,
    correlatedLogCount,
    errorSpanCount,
    routes: Object.freeze([...routes])
  });
}
