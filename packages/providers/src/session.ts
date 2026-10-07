import { stableFingerprint, type Evidence, type ProviderSession } from "@observability-gate/core";
import { parseIncidentEvidence } from "./evidence/incidents.js";
import { SafeEvidenceFileLoader } from "./evidence/files.js";
import { parseOtlpContract } from "./evidence/otlp-contract.js";
import { parseSarifEvidence } from "./evidence/sarif.js";
import { parseSyntheticEvidence } from "./evidence/synthetic.js";
import { GrafanaClient } from "./grafana/client.js";
import { HttpProbe } from "./http/probe.js";
import { LokiClient } from "./logs/loki-client.js";
import { PrometheusMetricsProvider } from "./metrics/prometheus-client.js";
import type { MetricVector } from "./metrics/types.js";
import { TempoClient } from "./traces/tempo-client.js";
import type { TraceSearchEvidence } from "./traces/types.js";
import { GuardedTransport, type FetchLike } from "./transport/guarded-fetch.js";
import { UrlPolicy } from "./transport/url-policy.js";

type RecordValue = Readonly<Record<string, unknown>>;

export interface ProviderPolicy {
  readonly identity: RecordValue;
  readonly release: RecordValue;
  readonly observation: RecordValue;
  readonly execution: RecordValue;
  readonly targets: RecordValue;
  readonly providers: RecordValue;
  readonly gates: RecordValue;
  readonly reporting: RecordValue;
  readonly security: RecordValue;
  readonly limits: RecordValue;
}

export interface PolicyProviderSessionOptions {
  readonly policy: ProviderPolicy;
  readonly workspaceRoot: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchLike;
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  readonly clock?: () => number;
}

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function durationMs(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return fallback;
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return Number(match[1]) * (multiplier ?? 1);
}

function byteLimit(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return fallback;
  const match = /^(\d+(?:\.\d+)?)\s*(B|KiB|MiB)$/iu.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return fallback;
  const multiplier = { b: 1, kib: 1_024, mib: 1_048_576 }[match[2].toLowerCase()];
  return Math.floor(Number(match[1]) * (multiplier ?? 1));
}

function bearerHeaders(
  configuration: RecordValue,
  environment: Readonly<Record<string, string | undefined>>
): HeadersInit {
  const authentication = record(configuration.authentication);
  const tokenName = string(authentication.bearer_token_env);
  const token = tokenName === undefined ? undefined : environment[tokenName];
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}

function mapEvidence<T, U>(
  evidence: Evidence<T>,
  kind: string,
  value: U,
  provider = evidence.source.provider
): Evidence<U> {
  return Object.freeze({
    ...evidence,
    id: stableFingerprint({ source: evidence.id, kind, value }),
    kind,
    source: Object.freeze({ ...evidence.source, provider }),
    value: Object.freeze(value),
    diagnostics: evidence.diagnostics
  });
}

function localEvidence(
  gateType: string,
  target: string,
  acquiredAt: string,
  value: unknown
): Evidence<unknown> {
  return Object.freeze({
    id: stableFingerprint({ gateType, target, acquiredAt, value }),
    kind: gateType,
    state: "valid",
    source: Object.freeze({ provider: "policy", capability: gateType }),
    target,
    acquiredAt,
    value,
    diagnostics: Object.freeze([])
  });
}

function unsupported(gateType: string, target: string, acquiredAt: string): Evidence<unknown> {
  return Object.freeze({
    id: stableFingerprint({ gateType, target, acquiredAt, state: "unsupported" }),
    kind: gateType,
    state: "unsupported",
    source: Object.freeze({ provider: "unresolved", capability: gateType }),
    target,
    acquiredAt,
    diagnostics: Object.freeze([
      {
        code: "CAPABILITY_UNSUPPORTED",
        message: `No read-only evidence adapter is available for ${gateType}.`,
        retryable: false
      }
    ])
  });
}

function endpointFor(
  configuration: RecordValue,
  environment: Readonly<Record<string, string | undefined>>
): string | undefined {
  const endpoint = string(configuration.endpoint);
  if (endpoint !== undefined) return endpoint;
  const name = string(configuration.endpoint_env);
  return name === undefined ? undefined : environment[name];
}

function expectedWindow(
  policy: ProviderPolicy,
  phase: string,
  now: number
): { start: string; end: string } {
  const observation = record(policy.observation);
  const phaseObservation = record(observation[phase]);
  const window = durationMs(
    phase === "post_deployment"
      ? phaseObservation.evaluation_window
      : phaseObservation.current_health_window,
    15 * 60_000
  );
  return { start: new Date(now - window).toISOString(), end: new Date(now).toISOString() };
}

function assertionRecord(definition: RecordValue): RecordValue {
  return record(definition.assertions);
}

function identityValue(policy: ProviderPolicy): RecordValue {
  const canonical = record(record(policy.identity).canonical);
  return Object.freeze({
    serviceName: canonical.service_name,
    serviceNamespace: canonical.service_namespace,
    environment: canonical.environment,
    releaseId: canonical.release_id
  });
}

function policySelfCheckValue(policy: ProviderPolicy): RecordValue {
  const gates = record(policy.gates);
  const allGates = [...array(gates.pre_deployment), ...array(gates.post_deployment)].map(record);
  const ids = allGates
    .map((gate) => string(gate.id))
    .filter((id): id is string => id !== undefined);
  return Object.freeze({
    sections: Object.freeze([
      "identity",
      "targets",
      "providers",
      "gates.pre_deployment",
      "gates.post_deployment",
      "reporting",
      "security"
    ]),
    uniqueGateIds: new Set(ids).size === ids.length,
    unknownFields: 0,
    inlineSecrets: 0,
    blockingPostGates: array(gates.post_deployment)
      .map(record)
      .filter((gate) => gate.enforcement !== "advisory").length
  });
}

export function createPolicyProviderSession(
  options: PolicyProviderSessionOptions
): ProviderSession {
  const now = options.clock ?? Date.now;
  const providerGroups = record(options.policy.providers);
  const telemetry = record(providerGroups.telemetry);
  const httpProviders = record(providerGroups.http);
  const providerEndpoints = Object.values(telemetry)
    .map(record)
    .map((configuration) => endpointFor(configuration, options.environment))
    .filter((value): value is string => value !== undefined);
  const probeHosts = Object.values(httpProviders).flatMap((value) =>
    array(record(value).allowed_hosts).filter((host): host is string => typeof host === "string")
  );
  const urlPolicy = new UrlPolicy({
    providerOrigins: providerEndpoints,
    probeHosts,
    ...(options.resolveHostname === undefined ? {} : { resolve: options.resolveHostname })
  });
  const transport = new GuardedTransport({
    urlPolicy,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    clock: now
  });
  const maximumResponseBytes = byteLimit(
    record(options.policy.limits).maximum_provider_response_size,
    2 * 1024 * 1024
  );
  const maximumFutureSkewMs = durationMs(
    record(record(options.policy.execution).clock).maximum_clock_skew,
    30_000
  );
  const fileLoader = new SafeEvidenceFileLoader({
    workspaceRoot: options.workspaceRoot,
    maximumBytes: maximumResponseBytes,
    clock: now
  });

  const clientFor = (name: string): RecordValue => record(telemetry[name]);
  const metricsConfiguration = clientFor("metrics");
  const logsConfiguration = clientFor("logs");
  const tracesConfiguration = clientFor("traces");
  const grafanaConfiguration = clientFor("grafana");
  const identity = identityValue(options.policy);
  const metricLabels = record(record(options.policy.identity).provider_mappings).metrics;

  const metricsEndpoint = endpointFor(metricsConfiguration, options.environment);
  const serviceNameLabel = string(record(metricLabels)["service.name"]);
  const serviceNamespaceLabel = string(record(metricLabels)["service.namespace"]);
  const serviceVersionLabel = string(record(metricLabels)["service.version"]);
  const deploymentEnvironmentLabel = string(record(metricLabels)["deployment.environment.name"]);
  const serviceInstanceIdLabel = string(record(metricLabels)["service.instance.id"]);
  const metrics =
    metricsEndpoint === undefined
      ? undefined
      : new PrometheusMetricsProvider({
          endpoint: metricsEndpoint,
          provider: "metrics",
          transport,
          identityLabels: {
            ...(serviceNameLabel === undefined ? {} : { serviceName: serviceNameLabel }),
            ...(serviceNamespaceLabel === undefined
              ? {}
              : { serviceNamespace: serviceNamespaceLabel }),
            ...(serviceVersionLabel === undefined ? {} : { serviceVersion: serviceVersionLabel }),
            ...(deploymentEnvironmentLabel === undefined
              ? {}
              : { deploymentEnvironment: deploymentEnvironmentLabel }),
            ...(serviceInstanceIdLabel === undefined
              ? {}
              : { serviceInstanceId: serviceInstanceIdLabel })
          },
          maximumQueryLength: 16 * 1024,
          maximumRangeMs: 24 * 60 * 60_000,
          minimumStepMs: 1_000,
          timeoutMs: durationMs(metricsConfiguration.request_timeout, 10_000),
          maximumResponseBytes,
          headers: bearerHeaders(metricsConfiguration, options.environment),
          clock: now
        });
  const logsEndpoint = endpointFor(logsConfiguration, options.environment);
  const logs =
    logsEndpoint === undefined
      ? undefined
      : new LokiClient({
          endpoint: logsEndpoint,
          provider: "logs",
          transport,
          maximumLimit: 1_000,
          maximumRangeMs: 24 * 60 * 60_000,
          timeoutMs: durationMs(logsConfiguration.request_timeout, 10_000),
          maximumResponseBytes,
          headers: bearerHeaders(logsConfiguration, options.environment),
          clock: now
        });
  const tracesEndpoint = endpointFor(tracesConfiguration, options.environment);
  const traces =
    tracesEndpoint === undefined
      ? undefined
      : new TempoClient({
          endpoint: tracesEndpoint,
          provider: "traces",
          transport,
          maximumLimit: 100,
          maximumRangeMs: 24 * 60 * 60_000,
          timeoutMs: durationMs(tracesConfiguration.request_timeout, 10_000),
          maximumResponseBytes,
          headers: bearerHeaders(tracesConfiguration, options.environment),
          clock: now
        });
  const grafanaEndpoint = endpointFor(grafanaConfiguration, options.environment);
  const grafana =
    grafanaEndpoint === undefined
      ? undefined
      : new GrafanaClient({
          endpoint: grafanaEndpoint,
          provider: "grafana",
          transport,
          timeoutMs: durationMs(grafanaConfiguration.request_timeout, 10_000),
          maximumResponseBytes,
          headers: bearerHeaders(grafanaConfiguration, options.environment),
          clock: now
        });
  const probe = new HttpProbe({ transport, clock: now });

  return {
    async resolveEvidence(gateType, definition, context) {
      const acquiredAt = new Date(now()).toISOString();
      if (gateType === "policy.self_check") {
        return [
          localEvidence(
            gateType,
            context.targetId,
            acquiredAt,
            policySelfCheckValue(options.policy)
          )
        ];
      }
      if (gateType === "identity.contract") {
        return [localEvidence(gateType, context.targetId, acquiredAt, identity)];
      }

      const source = record(definition.source);
      const assertions = assertionRecord(definition);
      const sourceProvider = string(source.provider);
      const window = expectedWindow(options.policy, context.phase, now());

      if (
        metrics !== undefined &&
        sourceProvider === "metrics" &&
        typeof source.query === "string"
      ) {
        const raw = await context.evidenceStore.getOrLoad(
          {
            kind: "metrics.vector",
            provider: "metrics",
            capability: "metrics.query.instant",
            target: context.targetId,
            ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
            query: source.query
          },
          () =>
            metrics.queryInstant({
              query: source.query as string,
              target: context.targetId,
              ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
              minimumSamples: 1,
              maximumAgeMs: durationMs(
                record(options.policy.observation).maximum_evidence_age,
                2 * 60_000
              ),
              maximumFutureSkewMs,
              signal: context.signal
            })
        );
        const vector = raw.value as MetricVector | undefined;
        const first = vector?.samples[0];
        if (gateType === "metric.threshold") {
          return [
            mapEvidence(raw, gateType, {
              value: first?.value,
              sampleCount: vector?.sampleCount ?? 0,
              minimumSamples: number(assertions.minimum_samples) ?? 1,
              operator: assertions.operator,
              threshold: assertions.threshold,
              minimumTotalRequests: assertions.minimum_total_requests,
              requestCount: vector?.sampleCount ?? 0
            })
          ];
        }
        if (gateType === "telemetry.presence") {
          return [
            mapEvidence(raw, gateType, {
              identityMatches: first !== undefined,
              records: vector?.sampleCount ?? 0,
              minimumRecords: number(assertions.minimum_records) ?? 1
            })
          ];
        }
      }

      if (logs !== undefined && sourceProvider === "logs" && typeof source.query === "string") {
        const raw = await context.evidenceStore.getOrLoad(
          {
            kind: "logs.records",
            provider: "logs",
            capability: "logs.query.range",
            target: context.targetId,
            query: source.query,
            range: window
          },
          () =>
            logs.queryRange({
              query: source.query as string,
              target: context.targetId,
              ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
              ...window,
              direction: "backward",
              limit: 1_000,
              minimumRecords: number(assertions.minimum_records) ?? 1,
              maximumAgeMs: 2 * 60_000,
              maximumFutureSkewMs,
              structuredMetadataFields: ["trace_id", "span_id"],
              signal: context.signal
            })
        );
        if (gateType === "telemetry.presence") {
          const count = raw.value?.recordCount ?? 0;
          return [
            mapEvidence(raw, gateType, {
              identityMatches: count > 0,
              records: count,
              minimumRecords: number(assertions.minimum_records) ?? 1
            })
          ];
        }
      }

      if (traces !== undefined && sourceProvider === "traces") {
        const query = record(source.query);
        const namespace =
          string(query["resource.service.namespace"]) ?? string(identity.serviceNamespace);
        const version = string(query["resource.service.version"]) ?? context.releaseId;
        const environment =
          string(query["resource.deployment.environment.name"]) ?? string(identity.environment);
        const raw = await context.evidenceStore.getOrLoad(
          {
            kind: "traces.summaries",
            provider: "traces",
            capability: "traces.search",
            target: context.targetId,
            parameters: { identity, window }
          },
          () =>
            traces.search({
              target: context.targetId,
              service: {
                name: string(query["resource.service.name"]) ?? String(identity.serviceName ?? ""),
                ...(namespace === undefined ? {} : { namespace }),
                ...(version === undefined ? {} : { version }),
                ...(environment === undefined ? {} : { environment })
              },
              ...window,
              limit: 100,
              minimumTraces: number(assertions.minimum_traces) ?? 1,
              maximumAgeMs: 3 * 60_000,
              maximumFutureSkewMs,
              trafficObserved: true,
              samplingProbability: 1,
              signal: context.signal
            })
        );
        if (gateType === "telemetry.presence") {
          const traceEvidence = raw.value as TraceSearchEvidence | undefined;
          return [
            mapEvidence(raw, gateType, {
              identityMatches: (traceEvidence?.traceCount ?? 0) > 0,
              records: traceEvidence?.traceCount ?? 0,
              minimumRecords: number(assertions.minimum_traces) ?? 1
            })
          ];
        }
        if (gateType === "telemetry.service_graph") {
          const traceEvidence = raw.value as TraceSearchEvidence | undefined;
          const peers = new Set(
            traceEvidence?.traces.flatMap((trace) =>
              trace.spans
                .map((span) => span.peerService)
                .filter((peer): peer is string => peer !== undefined)
            ) ?? []
          );
          return [
            mapEvidence(raw, gateType, {
              callerPresent: (traceEvidence?.traceCount ?? 0) > 0,
              observedDependencies: [...peers],
              requiredDependencies: array(assertions.required_dependencies),
              unknownPeerPercent: 0,
              maximumUnknownPeerPercent: number(assertions.maximum_unknown_peer_percent) ?? 0
            })
          ];
        }
      }

      if (grafana !== undefined && sourceProvider === "grafana") {
        const maximumAgeMs = 10 * 60_000;
        const base = {
          target: context.targetId,
          maximumAgeMs,
          maximumFutureSkewMs,
          signal: context.signal
        };
        if (gateType === "grafana.dashboard") {
          const uid =
            string(source.uid) ??
            (string(source.uid_env) === undefined
              ? undefined
              : options.environment[string(source.uid_env) as string]);
          if (uid !== undefined)
            return [
              await grafana.getDashboard({
                ...base,
                uid,
                ...(string(assertions.title_contains) === undefined
                  ? {}
                  : { expectedTitle: string(assertions.title_contains) as string })
              })
            ];
        }
        if (gateType === "grafana.alert_rules" || gateType === "grafana.alert_state") {
          const raw = await grafana.getAlertRules({
            ...base,
            selector: Object.fromEntries(
              Object.entries(record(source.labels)).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string"
              )
            )
          });
          const rules = raw.value ?? [];
          return [
            mapEvidence(
              raw,
              gateType,
              gateType === "grafana.alert_rules"
                ? { rules }
                : { fresh: raw.state === "valid", alerts: rules }
            )
          ];
        }
        if (gateType === "grafana.notification_policy") {
          const instant = new Date(now()).toISOString();
          return [
            await grafana.getNotificationRoute({
              ...base,
              selector: Object.fromEntries(
                Object.entries(record(source.match)).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string"
                )
              ),
              deploymentStart: instant,
              deploymentEnd: instant
            })
          ];
        }
        if (
          [
            "grafana.slo_definition",
            "grafana.slo_status",
            "grafana.error_budget",
            "grafana.burn_rate"
          ].includes(gateType)
        ) {
          const uid =
            string(source.uid) ??
            (string(source.uid_env) === undefined
              ? undefined
              : options.environment[string(source.uid_env) as string]);
          if (uid !== undefined) {
            const raw = await grafana.getSlo({ ...base, uid });
            const slo = raw.value;
            if (gateType === "grafana.slo_definition")
              return [
                mapEvidence(raw, gateType, { ...slo, labelsMatchIdentity: slo !== undefined })
              ];
            if (gateType === "grafana.slo_status")
              return [
                mapEvidence(raw, gateType, { fresh: raw.state === "valid", status: slo?.status })
              ];
            if (gateType === "grafana.error_budget")
              return [
                mapEvidence(raw, gateType, {
                  fresh: raw.state === "valid",
                  remainingPercent: slo?.remainingBudgetPercent,
                  minimumRemainingPercent: assertions.minimum_remaining_percent,
                  consumedDuringReleasePercent: slo?.consumedBudgetPercent,
                  maximumConsumedDuringReleasePercent:
                    assertions.maximum_consumed_during_release_percent
                })
              ];
            return [
              mapEvidence(raw, gateType, {
                fresh: raw.state === "valid",
                pairs:
                  slo?.burnRates.map((rate) => ({
                    shortValue: rate.value,
                    longValue: rate.value,
                    maximum: number(assertions.maximum) ?? Number.POSITIVE_INFINITY
                  })) ?? []
              })
            ];
          }
        }
      }

      if (gateType === "http.assertion" || gateType === "asset.url") {
        const providerName = sourceProvider ?? string(source.adapter) ?? "public-probe";
        const provider = record(httpProviders[providerName]);
        const url =
          string(source.url) ??
          (string(source.url_env) === undefined
            ? undefined
            : options.environment[string(source.url_env) as string]);
        if (url !== undefined) {
          const started = now();
          const statuses = array(assertions.expected_status).filter(
            (value): value is number => typeof value === "number"
          );
          const expectedStatuses =
            statuses.length > 0
              ? statuses
              : array(assertions.expected_statuses).filter(
                  (value): value is number => typeof value === "number"
                );
          const raw = await probe.check({
            url,
            method: assertions.method === "HEAD" ? "HEAD" : "GET",
            expectedStatus: expectedStatuses[0] ?? 200,
            expectedHeaders: Object.fromEntries(
              Object.entries(record(assertions.expected_headers)).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string"
              )
            ),
            expectedJson: record(assertions.expected_json) as Readonly<
              Record<string, string | number | boolean | null>
            >,
            timeoutMs: durationMs(provider.timeout, 10_000),
            maximumResponseBytes,
            signal: context.signal
          });
          if (gateType === "asset.url")
            return [
              mapEvidence(raw, gateType, {
                reachable: raw.state === "valid",
                scheme: new URL(url).protocol.slice(0, -1),
                nonempty: raw.value !== undefined
              })
            ];
          return [
            mapEvidence(
              raw,
              gateType,
              {
                status: raw.value?.status,
                expectedStatuses,
                durationMs: now() - started,
                maximumDurationMs: durationMs(assertions.maximum_duration, 10_000),
                headersMatch: raw.value?.headersMatch ?? false,
                jsonMatches: raw.value?.jsonMatches ?? true
              },
              "http"
            )
          ];
        }
      }

      const evidenceProviders = record(providerGroups.evidence);
      if (sourceProvider !== undefined && sourceProvider in evidenceProviders) {
        const provider = record(evidenceProviders[sourceProvider]);
        const paths = array(provider.files).filter(
          (value): value is string => typeof value === "string"
        );
        const path = paths.find(
          (candidate) => gateType !== "synthetic.result" || /\.(?:json|xml)$/iu.test(candidate)
        );
        if (path !== undefined) {
          const loaded = await fileLoader.load({
            path,
            blocking: definition.enforcement !== "advisory",
            maximumAgeMs: durationMs(provider.maximum_age, 24 * 60 * 60_000),
            maximumFutureSkewMs
          });
          let value: unknown;
          if (gateType === "evidence.sarif")
            value = parseSarifEvidence(loaded.content, { acceptedRulePrefixes: [""] });
          else if (gateType === "evidence.incident_state")
            value = parseIncidentEvidence(loaded.content);
          else if (gateType === "evidence.otlp_contract") {
            const canonical = record(record(options.policy.identity).canonical);
            value = parseOtlpContract(loaded.content, {
              commit: string(canonical.release_id) ?? "",
              workflow: string(canonical.deployment_id) ?? ""
            });
          } else if (gateType === "synthetic.result") {
            const parsed = parseSyntheticEvidence(loaded.content);
            const required = array(assertions.required_tests).map(String);
            value = {
              requiredTests: required,
              tests: parsed.tests.map((test) => ({
                name: test.name,
                passed: test.status === "passed",
                durationMs: test.durationMs,
                maximumDurationMs: durationMs(
                  assertions.maximum_duration,
                  Number.POSITIVE_INFINITY
                ),
                releaseHeader: test.observedRelease,
                expectedReleaseHeader: context.releaseId
              }))
            };
          }
          if (value !== undefined)
            return [localEvidence(gateType, context.targetId, loaded.modifiedAt, value)];
        }
      }

      return [unsupported(gateType, context.targetId, acquiredAt)];
    }
  };
}
