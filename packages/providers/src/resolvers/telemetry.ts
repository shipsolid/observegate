import { parseOtlpContract } from "../evidence/otlp-contract.js";
import type { Evidence } from "@observability-gate/core";
import type { MetricsProvider, MetricVector, MetricMatrix } from "../metrics/types.js";
import type { LogsProvider, LogRecordEvidence } from "../logs/types.js";
import type { TracesProvider, TraceSearchEvidence } from "../traces/types.js";
import {
  array,
  combined,
  configuration,
  durationMs,
  identity,
  loadFiles,
  evidence,
  invalid,
  mapped,
  matches,
  number,
  record,
  string,
  type Context,
  type Data,
  type ResolverBase
} from "./shared.js";

export interface TelemetryResolver extends ResolverBase {
  readonly metrics?: MetricsProvider;
  readonly logs?: LogsProvider;
  readonly traces?: TracesProvider;
}
export function windowFor(base: ResolverBase, context: Context) {
  const observation = record(base.policy.observation[context.phase]);
  const end = base.now() - durationMs(observation.current_health_offset, 0);
  return {
    start: new Date(
      end -
        durationMs(
          context.phase === "pre_deployment"
            ? observation.current_health_window
            : observation.evaluation_window,
          900000
        )
    ).toISOString(),
    end: new Date(end).toISOString()
  };
}
export async function metric(
  base: TelemetryResolver,
  query: unknown,
  context: Context
): Promise<Evidence<MetricVector>> {
  if (base.metrics === undefined || typeof query !== "string" || query.length === 0)
    configuration(
      "Metric acquisition requires a configured metrics provider and an explicit bounded query"
    );
  return context.evidenceStore.getOrLoad(
    {
      kind: "metrics.vector",
      provider: "metrics",
      capability: "metrics.query.instant",
      target: context.targetId,
      ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
      query
    },
    () =>
      (base.metrics ?? configuration("Metrics provider is missing")).queryInstant({
        query,
        target: context.targetId,
        ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
        minimumSamples: 1,
        maximumAgeMs: durationMs(
          record(base.policy.observation[context.phase]).maximum_evidence_age,
          120000
        ),
        maximumFutureSkewMs: base.maximumFutureSkewMs,
        signal: context.signal
      })
  );
}
export function scalar(raw: Evidence<MetricVector>): number | undefined {
  if (raw.state !== "valid") return undefined;
  if (raw.value?.samples.length !== 1)
    invalid(
      "Scalar gate query must return exactly one metric sample; aggregate or filter the query"
    );
  return raw.value.samples[0]?.value;
}
export async function logRecords(
  base: TelemetryResolver,
  query: unknown,
  context: Context
): Promise<Evidence<LogRecordEvidence>> {
  if (base.logs === undefined || typeof query !== "string")
    configuration(
      "Log acquisition requires a logs provider and source.query or source.queries.logs"
    );
  const range = windowFor(base, context);
  return context.evidenceStore.getOrLoad(
    {
      kind: "logs.records",
      provider: "logs",
      capability: "logs.query.range",
      target: context.targetId,
      ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
      query,
      range
    },
    () =>
      (base.logs ?? configuration("Logs provider is missing")).queryRange({
        query,
        target: context.targetId,
        ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
        ...range,
        direction: "backward",
        limit: 1000,
        minimumRecords: 1,
        maximumAgeMs: 120000,
        maximumFutureSkewMs: base.maximumFutureSkewMs,
        structuredMetadataFields: [
          "trace_id",
          "span_id",
          ...Object.values(record(record(base.policy.identity.provider_mappings).logs)).filter(
            (v): v is string => typeof v === "string"
          )
        ],
        signal: context.signal
      })
  );
}
export async function traceRecords(
  base: TelemetryResolver,
  source: Data,
  context: Context
): Promise<Evidence<TraceSearchEvidence>> {
  if (base.traces === undefined)
    configuration("Trace acquisition requires a configured traces provider");
  const query = record(source.query),
    expected = identity(base.policy),
    range = windowFor(base, context);
  const service = {
    name: string(query["resource.service.name"]) ?? String(expected.serviceName ?? ""),
    namespace:
      string(query["resource.service.namespace"]) ?? String(expected.serviceNamespace ?? ""),
    version:
      string(query["resource.service.version"]) ??
      String(context.releaseId ?? expected.releaseId ?? ""),
    environment:
      string(query["resource.deployment.environment.name"]) ?? String(expected.environment ?? "")
  };
  return context.evidenceStore.getOrLoad(
    {
      kind: "traces.summaries",
      provider: "traces",
      capability: "traces.search",
      target: context.targetId,
      ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
      parameters: { service, range }
    },
    () =>
      (base.traces ?? configuration("Traces provider is missing")).search({
        target: context.targetId,
        service,
        ...range,
        limit: 100,
        minimumTraces: 1,
        maximumAgeMs: 180000,
        maximumFutureSkewMs: base.maximumFutureSkewMs,
        trafficObserved: source.traffic_observed === true,
        samplingProbability: number(source.sampling_probability) ?? 1,
        signal: context.signal
      })
  );
}
function logIdentity(base: ResolverBase, labels: Data): Data {
  const mapping = record(record(base.policy.identity.provider_mappings).logs);
  return {
    serviceName: labels[String(mapping["service.name"] ?? "resource_service_name")],
    serviceNamespace: labels[String(mapping["service.namespace"] ?? "resource_service_namespace")],
    serviceVersion: labels[String(mapping["service.version"] ?? "resource_service_version")],
    deploymentEnvironment:
      labels[
        String(mapping["deployment.environment.name"] ?? "resource_deployment_environment_name")
      ]
  };
}
function compare(value: number | undefined, rule: Data): boolean {
  return (
    value !== undefined &&
    Object.entries(rule).every(
      ([op, t]) =>
        typeof t === "number" &&
        (op === "less_than_or_equal"
          ? value <= t
          : op === "greater_than_or_equal"
            ? value >= t
            : op === "less_than"
              ? value < t
              : op === "greater_than"
                ? value > t
                : op === "equal"
                  ? value === t
                  : false)
    )
  );
}
export async function resolveTelemetry(
  base: TelemetryResolver,
  kind: string,
  definition: Data,
  context: Context
): Promise<readonly Evidence<unknown>[] | undefined> {
  const source = record(definition.source),
    assertions = record(definition.assertions),
    queries = record(source.queries ?? assertions.queries),
    expected = identity(base.policy);
  if (kind === "telemetry.contract") {
    const files = await loadFiles(base, definition),
      file = files[0],
      parsed = parseOtlpContract(
        file.content,
        {
          commit: String(record(base.policy.identity.canonical).release_id ?? ""),
          workflow: String(record(base.policy.identity.canonical).deployment_id ?? "")
        },
        { forbiddenFields: array(assertions.forbid_sensitive_fields).map(String) }
      ),
      root = record(JSON.parse(file.content.toString("utf8")));
    const [m, l, t] = await Promise.all([
        metric(base, queries.metrics, context),
        logRecords(base, queries.logs, context),
        traceRecords(base, source, context)
      ]),
      raws: Evidence<unknown>[] = [m, l, t];
    const captured = evidence(
      "evidence.otlp_contract",
      context,
      file.modifiedAt,
      parsed,
      string(source.provider) ?? "evidence",
      "evidence.otlp_contract"
    );
    raws.push(captured);
    const resource = parsed.resource;
    const resourceValid =
      resource.serviceName === expected.serviceName &&
      resource.serviceNamespace === expected.serviceNamespace &&
      resource.serviceVersion === expected.releaseId &&
      resource.deploymentEnvironment === expected.environment &&
      m.value?.samples.every((s) => matches(s.identity as Data, expected)) === true &&
      l.value?.records.every((s) =>
        matches(logIdentity(base, { ...s.labels, ...s.structuredMetadata }), expected)
      ) === true &&
      t.value?.traces.every((s) => matches(s.identity as Data, expected)) === true;
    return [
      combined(raws, kind, {
        signals: [
          ...(m.value?.sampleCount ? ["metrics"] : []),
          ...(l.value?.recordCount ? ["logs"] : []),
          ...(t.value?.traceCount ? ["traces"] : [])
        ],
        requiredSignals: array(assertions.required_signals).length
          ? array(assertions.required_signals)
          : ["metrics", "logs", "traces"],
        resourceAttributesValid: resourceValid,
        httpServerDurationMetricPresent: array(root.metrics).some((m) =>
          /^(?:http\.server\.(?:request\.)?duration|http_server_(?:request_)?duration)/u.test(
            String(record(m).name)
          )
        ),
        errorLogsPresent: array(root.logs).some(
          (l) => record(l).severity === "ERROR" || Number(record(l).severityNumber) >= 17
        ),
        serverSpansPresent:
          t.value?.traces.some((trace) =>
            trace.spans.some((span) => span.kind?.toUpperCase() === "SERVER")
          ) ?? false,
        forbiddenFieldsFound: []
      }),
      ...raws
    ];
  }
  if (kind === "metric.threshold") {
    const minimumSamples = number(assertions.minimum_samples) ?? 1;
    let raw: Evidence<MetricVector | MetricMatrix>;
    let value: number | undefined;
    if (minimumSamples > 1 || typeof definition.window === "string") {
      if (base.metrics === undefined || typeof source.query !== "string")
        configuration(
          "Metric range acquisition requires a metrics provider and explicit source.query"
        );
      const end = new Date(base.now()).toISOString(),
        start = new Date(base.now() - durationMs(definition.window, 600000)).toISOString(),
        query = source.query,
        stepMs = durationMs(source.step, 30000),
        client = base.metrics;
      raw = await context.evidenceStore.getOrLoad(
        {
          kind: "metrics.matrix",
          provider: "metrics",
          capability: "metrics.query.range",
          target: context.targetId,
          ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
          query,
          range: { start, end, stepMs }
        },
        () =>
          client.queryRange({
            query,
            target: context.targetId,
            ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
            start,
            end,
            stepMs,
            minimumSamples: 1,
            maximumAgeMs: 120000,
            maximumFutureSkewMs: base.maximumFutureSkewMs,
            signal: context.signal
          })
      );
      if (raw.state === "valid" && raw.value?.resultType === "matrix") {
        if (raw.value.series.length !== 1)
          invalid("Scalar threshold range query must return exactly one metric series");
        const values = raw.value.series[0]?.samples.map((s) => s.value) ?? [];
        const operator = String(assertions.operator);
        value =
          values.length === 0
            ? undefined
            : ["equal", "eq"].includes(operator)
              ? (values.find((sample) => sample !== assertions.threshold) ?? values[0])
              : ["lt", "lte", "less_than", "less_than_or_equal"].includes(operator)
                ? Math.max(...values)
                : Math.min(...values);
      }
    } else {
      raw = await metric(base, source.query, context);
      value = scalar(raw as Evidence<MetricVector>);
    }
    const minimumRequests = number(
      assertions.minimum_requests ?? assertions.minimum_total_requests
    );
    const requestQuery = source.request_count_query ?? queries.requests;
    if (minimumRequests !== undefined && requestQuery === undefined)
      configuration(
        "metric.threshold with minimum_requests requires source.request_count_query; metric sample count is not request count"
      );
    const requests =
      requestQuery === undefined ? undefined : await metric(base, requestQuery, context);
    return [
      combined(requests === undefined ? [raw] : [raw, requests], kind, {
        value,
        sampleCount: raw.value?.sampleCount ?? 0,
        minimumSamples: number(assertions.minimum_samples) ?? 1,
        operator: assertions.operator,
        threshold: assertions.threshold,
        ...(minimumRequests === undefined ? {} : { minimumRequests }),
        ...(requests === undefined ? {} : { requestCount: scalar(requests) })
      }),
      ...(requests === undefined ? [raw] : [raw, requests])
    ];
  }
  if (kind === "telemetry.presence") {
    if (source.provider === "metrics") {
      const raw = await metric(base, source.query, context);
      return [
        mapped(raw, kind, {
          identityMatches:
            (raw.value?.samples.length ?? 0) > 0 &&
            raw.value?.samples.every((s) => matches(s.identity as Data, expected)),
          records: raw.value?.sampleCount ?? 0,
          minimumRecords: number(assertions.minimum_records) ?? 1
        })
      ];
    }
    if (source.provider === "logs") {
      const raw = await logRecords(base, source.query, context);
      return [
        mapped(raw, kind, {
          identityMatches:
            (raw.value?.recordCount ?? 0) > 0 &&
            raw.value?.records.every((s) =>
              matches(logIdentity(base, { ...s.labels, ...s.structuredMetadata }), expected)
            ),
          records: raw.value?.recordCount ?? 0,
          minimumRecords: number(assertions.minimum_records) ?? 1
        })
      ];
    }
    if (source.provider === "traces") {
      const raw = await traceRecords(base, source, context);
      return [
        mapped(raw, kind, {
          identityMatches:
            (raw.value?.traceCount ?? 0) > 0 &&
            raw.value?.traces.every((t) => matches(t.identity as Data, expected)),
          records: raw.value?.traceCount ?? 0,
          minimumRecords: number(assertions.minimum_traces ?? assertions.minimum_records) ?? 1
        })
      ];
    }
    configuration("telemetry.presence requires source.provider metrics, logs, or traces");
  }
  if (kind === "telemetry.service_graph") {
    const raw = await traceRecords(base, source, context),
      spans = raw.value?.traces.flatMap((t) => t.spans) ?? [],
      clients = spans.filter((s) => s.kind?.toLowerCase() === "client");
    const peers = clients
      .map((s) => s.peerService)
      .filter((p): p is string => p !== undefined && p.length > 0);
    const caller = string(source.caller ?? assertions.expected_caller);
    if (caller === undefined)
      configuration(
        "telemetry.service_graph requires source.caller or assertions.expected_caller to measure the caller relationship"
      );
    const callerPresent =
      raw.value?.traces.some(
        (t) =>
          t.spans.some((s) => s.serviceName === caller) &&
          t.spans.some((s) => s.serviceName === expected.serviceName)
      ) ?? false;
    return [
      mapped(raw, kind, {
        callerPresent,
        observedDependencies: [...new Set(peers)],
        requiredDependencies: array(assertions.required_dependencies),
        unknownPeerPercent:
          clients.length === 0 ? 100 : (100 * (clients.length - peers.length)) / clients.length,
        maximumUnknownPeerPercent: number(assertions.maximum_unknown_peer_percent) ?? 0
      })
    ];
  }
  if (
    kind === "telemetry.correlation" ||
    kind === "telemetry.freshness" ||
    kind === "telemetry.identity_consistency"
  ) {
    const metricQuery = queries.metrics,
      logQuery = queries.logs;
    const raw: Evidence<unknown>[] = [];
    const m =
      kind === "telemetry.correlation" ? undefined : await metric(base, metricQuery, context);
    if (m) raw.push(m);
    const l = await logRecords(base, logQuery, context);
    raw.push(l);
    const t = await traceRecords(base, source, context);
    raw.push(t);
    if (kind === "telemetry.correlation") {
      const sampled = (t.value?.traces ?? [])
        .filter((trace) => trace.spans.some((s) => s.status?.toUpperCase() === "ERROR"))
        .slice(0, number(assertions.sampled_error_traces) ?? 20);
      return [
        combined(raw, kind, {
          sampledCount: sampled.length,
          correlatedCount: sampled.filter((trace) =>
            l.value?.records.some(
              (log) =>
                log.traceId === trace.traceId &&
                trace.spans.some((span) => span.spanId === log.spanId)
            )
          ).length,
          minimumCorrelatedPercent: number(assertions.minimum_correlated_percent) ?? 100
        }),
        ...raw
      ];
    }
    if (kind === "telemetry.identity_consistency")
      return [
        combined(raw, kind, {
          expectedReleaseId: context.releaseId,
          identities: [
            ...(m?.value?.samples ?? []).map((s) => ({
              source: "metrics",
              releaseId: s.identity.serviceVersion,
              consistent: matches(s.identity as Data, expected)
            })),
            ...(l.value?.records ?? []).map((s) => {
              const i = logIdentity(base, { ...s.labels, ...s.structuredMetadata });
              return {
                source: "logs",
                releaseId: i.serviceVersion,
                consistent: matches(i, expected)
              };
            }),
            ...(t.value?.traces ?? []).map((s) => ({
              source: "traces",
              releaseId: s.identity.serviceVersion,
              consistent: matches(s.identity as Data, expected)
            }))
          ]
        }),
        ...raw
      ];
    const signals = [
      { name: "metrics", times: m?.value?.samples.map((s) => s.observedAt) ?? [] },
      { name: "logs", times: l.value?.records.map((s) => s.timestamp) ?? [] },
      { name: "traces", times: t.value?.traces.map((s) => s.observedAt) ?? [] }
    ].map(({ name, times }) => ({
      name,
      ageMs:
        times.length === 0
          ? Infinity
          : Math.max(0, base.now() - Math.max(...times.map(Date.parse))),
      futureSkewMs:
        times.length === 0
          ? Infinity
          : Math.max(0, Math.max(...times.map(Date.parse)) - base.now()),
      maximumAgeMs: durationMs(record(assertions.maximum_age)[name], 120000),
      maximumFutureSkewMs: base.maximumFutureSkewMs
    }));
    return [combined(raw, kind, { signals }), ...raw];
  }
  if (kind === "dependency.health") {
    const dependencies = array(definition.dependencies).map(record);
    if (dependencies.length === 0)
      configuration("dependency.health requires named dependencies with query and threshold");
    const raws: Evidence<unknown>[] = [];
    const values = [];
    for (const dependency of dependencies) {
      const raw = await metric(base, dependency.query ?? record(dependency.source).query, context);
      raws.push(raw);
      values.push({
        name: dependency.name,
        required: dependency.required !== false,
        healthy:
          raw.state === "valid" &&
          compare(
            scalar(raw),
            dependency.threshold === undefined
              ? {
                  [String(record(dependency.assertions).operator)]: record(dependency.assertions)
                    .threshold
                }
              : record(dependency.threshold)
          )
      });
    }
    return [combined(raws, kind, { dependencies: values }), ...raws];
  }
  if (
    kind === "telemetry.collector_health" ||
    kind === "metric.multi_threshold" ||
    kind === "runtime.capacity" ||
    kind === "telemetry.cardinality_estimate" ||
    kind === "telemetry.volume_estimate"
  ) {
    const entries = Object.entries(queries);
    if (entries.length === 0)
      configuration(
        `${kind} requires explicit source.queries (or assertions.queries) for every measured field`
      );
    const raws: Evidence<MetricVector>[] = [],
      values: Record<string, unknown> = {};
    for (const [name, query] of entries) {
      const raw = await metric(base, query, context);
      raws.push(raw);
      values[name] = scalar(raw);
    }
    if (kind === "telemetry.collector_health")
      return [
        combined(raws, kind, {
          exportFailures: values.export_failures,
          refusedRecords: values.refused_data,
          maximumQueueUtilizationPercent:
            typeof values.queue_utilization === "number"
              ? values.queue_utilization * 100
              : undefined,
          allowedQueueUtilizationPercent:
            100 *
            (number(record(record(assertions.thresholds).queue_utilization).less_than_or_equal) ??
              0.8)
        }),
        ...raws
      ];
    if (kind === "metric.multi_threshold")
      return [
        combined(raws, kind, {
          metrics: Object.entries(values).map(([name, value]) => {
            const threshold = record(record(assertions.thresholds)[name]);
            const entry = Object.entries(threshold)[0];
            return { name, value, operator: entry?.[0], threshold: entry?.[1] };
          }),
          minimumRequests: assertions.minimum_requests,
          requestCount: values.requests
        }),
        ...raws
      ];
    if (kind === "runtime.capacity")
      return [
        combined(raws, kind, {
          cpuPercent: values.cpu_percent,
          memoryPercent: values.memory_percent,
          diskPercent: values.disk_percent,
          surgeSchedulable: values.surge_schedulable === 1,
          maximumCpuPercent: assertions.maximum_cpu_percent,
          maximumMemoryPercent: assertions.maximum_memory_percent,
          maximumDiskPercent: assertions.maximum_disk_percent
        }),
        ...raws
      ];
    return [combined(raws, kind, { measurements: values }), ...raws];
  }
  return undefined;
}
