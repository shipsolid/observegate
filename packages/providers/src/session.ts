import {
  EvidenceStore,
  parseByteSize,
  type Evidence,
  type ExecutionPlan,
  type ProviderSession
} from "@observability-gate/core";
import { SafeEvidenceFileLoader } from "./evidence/files.js";
import { GrafanaClient } from "./grafana/client.js";
import { HttpProbe } from "./http/probe.js";
import { LokiClient } from "./logs/loki-client.js";
import { PrometheusMetricsProvider } from "./metrics/prometheus-client.js";
import { TempoClient } from "./traces/tempo-client.js";
import {
  GuardedTransport,
  type FetchLike,
  type TransportRequest
} from "./transport/guarded-fetch.js";
import { UrlPolicy } from "./transport/url-policy.js";
import { resolveArtifact } from "./resolvers/artifacts.js";
import {
  resolveTelemetry,
  metric,
  traceRecords,
  logRecords
} from "./resolvers/telemetry.js";
import { resolveComparison } from "./resolvers/comparison.js";
import { resolveGrafana } from "./resolvers/grafana.js";
import { createRuntimeResolver, type RuntimeClients } from "./resolvers/runtime.js";
import { verifiedDeployment } from "./resolvers/deployment.js";
import {
  activeRuntime,
  array,
  combined,
  configuration,
  durationMs,
  evidence,
  field,
  mapped,
  number,
  record,
  string,
  type Data,
  type Context
} from "./resolvers/shared.js";
export { bindAcquisitionPlan, validateProviderAcquisition } from "./resolvers/contracts.js";
type RecordValue = Data;
export interface ProviderPolicy {
  readonly identity: Data;
  readonly release: Data;
  readonly observation: Data;
  readonly execution: Data;
  readonly targets: Data;
  readonly providers: Data;
  readonly gates: Data;
  readonly reporting: Data;
  readonly security: Data;
  readonly limits: Data;
}
export interface PolicyProviderSessionOptions {
  readonly policy: ProviderPolicy;
  readonly workspaceRoot: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch?: FetchLike;
  readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
  readonly clock?: () => number;
  readonly runtimeClients?: RuntimeClients;
  readonly plan?: ExecutionPlan;
}
function bearerHeaders(
  configuration: Data,
  environment: Readonly<Record<string, string | undefined>>
): HeadersInit {
  const name = string(record(configuration.authentication).bearer_token_env),
    token = name === undefined ? undefined : environment[name];
  return token === undefined ? {} : { authorization: `Bearer ${token}` };
}
function endpointFor(
  configuration: Data,
  environment: Readonly<Record<string, string | undefined>>
): string | undefined {
  return field(configuration, "endpoint", environment);
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
  const deploymentSignature = record(record(record(providerGroups.evidence).deployment).signature);
  const jwksEndpoint = field(deploymentSignature, "jwks_url", options.environment);
  if (jwksEndpoint !== undefined) providerEndpoints.push(jwksEndpoint);
  const probeHosts = Object.values(httpProviders).flatMap((value) =>
    array(record(value).allowed_hosts).filter((host): host is string => typeof host === "string")
  );
  const urlPolicy = new UrlPolicy({
    providerOrigins: providerEndpoints,
    probeHosts,
    ...(options.resolveHostname === undefined ? {} : { resolve: options.resolveHostname })
  });
  const guarded = new GuardedTransport({
    urlPolicy,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    clock: now
  });
  const maximumResponseBytes =
    options.plan?.maximumResponseBytes ??
    parseByteSize(record(options.policy.limits).maximum_provider_response_size, 2 * 1024 * 1024);
  let requests = 0;
  const transport = {
    request: (request: TransportRequest) => {
      if (
        ++requests >
        (options.plan?.maximumQueries ?? number(options.policy.limits.maximum_queries) ?? 1000)
      )
        configuration("Provider read count exceeds limits.maximum_queries");
      const url = new URL(request.url);
      const query = url.searchParams.get("query") ?? url.searchParams.get("q") ?? "";
      if (
        Buffer.byteLength(query) >
        (options.plan?.maximumQueryLengthBytes ??
          parseByteSize(options.policy.limits.maximum_query_length, 16 * 1024))
      )
        configuration("Provider query exceeds limits.maximum_query_length");
      return guarded.request({
        ...request,
        maximumResponseBytes: Math.min(request.maximumResponseBytes, maximumResponseBytes)
      });
    }
  };
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

  const base = {
    policy: options.policy,
    environment: options.environment,
    files: fileLoader,
    now,
    maximumFutureSkewMs,
    ...(metrics === undefined ? {} : { metrics }),
    ...(logs === undefined ? {} : { logs }),
    ...(traces === undefined ? {} : { traces })
  };
  const runtime = createRuntimeResolver(base, options.runtimeClients);
  const resolve: NonNullable<ProviderSession["resolveEvidence"]> = async (
    gateType,
    definition,
    context
  ) => {
    if (context.signal.aborted) throw context.signal.reason;
    const source = record(definition.source),
      assertions = record(definition.assertions);
    if (gateType === "runtime.release_identity") {
      const [raw, attestation] = await Promise.all([
        runtime.snapshot(context),
        verifiedDeployment(base, transport, context)
      ]);
      const value = record(raw.value),
        observed = array(value.releaseIdentities).map(record),
        releaseIds = [...new Set(observed.map((v) => v.releaseId))];
      const revision = record(value.revision),
        pods = array(value.pods).map(record),
        digests = [...new Set(pods.map((p) => p.imageDigest).filter((v) => typeof v === "string"))];
      const expected = record(activeRuntime(options.policy).expected),
        imageDigest = field(expected, "image_digest", options.environment),
        artifactDigest = field(expected, "artifact_digest", options.environment);
      const queried=typeof source.runtime_release_query === "string" ? await metric(base,source.runtime_release_query,context) : undefined;
      const samples=queried?.value?.samples??[];
      const single=(values:readonly unknown[])=>{const unique=[...new Set(values.filter(v=>typeof v==="string"&&v.length>0))];return unique.length===1?unique[0]:undefined;};
      const observedRuntime={releaseId:queried===undefined?(releaseIds.length===1?releaseIds[0]:revision.suffix):single(samples.map(s=>s.identity.serviceVersion)),imageDigest:revision.imageDigest??(digests.length===1?digests[0]:single(samples.map(s=>s.labels.image_digest))),artifactDigest:single(samples.map(s=>s.labels.artifact_digest)),deploymentId:single(samples.map(s=>s.labels.deployment_id))};
      const requireDeploymentId=assertions.deployment_id!==undefined||observedRuntime.deploymentId!==undefined;
      return [
        mapped(raw, gateType, {
          runtime: observedRuntime,
          attestation: {
            releaseId: attestation.releaseId,
            ...(imageDigest === undefined
              ? { artifactDigest: attestation.artifactDigest }
              : { imageDigest: attestation.artifactDigest }),
            ...(requireDeploymentId?{deploymentId:attestation.deploymentId}:{})
          },
          expected: {
            releaseId: context.releaseId,
            ...(imageDigest === undefined ? {} : { imageDigest }),
            ...(artifactDigest === undefined ? {} : { artifactDigest }),
            ...(requireDeploymentId?{deploymentId:record(options.policy.identity.canonical).deployment_id}:{})
          }
        }),
        evidence("deployment.verified",context,new Date(now()).toISOString(),attestation,"deployment","deployment.verified"),
        ...(queried===undefined?[]:[queried])
      ];
    }
    if(gateType==="telemetry.identity_consistency") {
      const telemetryEvidence=await resolveTelemetry(base,gateType,definition,context)??[];
      const releases=await resolve("runtime.release_identity",definition,context),release=record(releases[0]?.value),expectedReleaseId=context.releaseId;
      const identities=[...array(record(telemetryEvidence[0]?.value).identities),...(["runtime","attestation"] as const).map(source=>({source,releaseId:record(release[source]).releaseId,consistent:record(release[source]).releaseId===expectedReleaseId}))];
      return [combined([...telemetryEvidence,...releases],gateType,{expectedReleaseId,identities}),...telemetryEvidence,...releases];
    }
    if(gateType==="azure_container_apps.replica_health"){
      const raw=await runtime.resolve(gateType,definition,context)??[],queries=record(source.queries),value=record(raw[0]?.value),replicas=record(value.replicas),measured:Record<string,unknown>={},queriesRaw:Evidence<unknown>[]=[];
      for(const[name,key]of [["activationFailures","activation_failures"],["deactivationFailures","deactivation_failures"]]){const query=queries[key??""];if(typeof query!=="string")configuration("Container Apps replica lifecycle assertions require source.queries.activation_failures and deactivation_failures");const evidence=await metric(base,query,context);queriesRaw.push(evidence);measured[String(name)]=evidence.value?.samples.length===1?evidence.value.samples[0]?.value:undefined;}
      const all=[...raw,...queriesRaw];return [combined(all,gateType,{...value,replicas:{...replicas,...measured}}),...all];
    }
    if(gateType==="deployment.concurrency"&&source.provider==="metrics"){
      const raw=await metric(base,source.query,context);
      const deployments=(raw.value?.samples??[]).map(sample=>{const id=sample.labels.deployment_id;if(id===undefined)configuration("Deployment concurrency query must retain deployment_id label");return {id,active:sample.value>0};});
      return [mapped(raw,gateType,{deployments,currentDeploymentId:record(options.policy.identity.canonical).deployment_id})];
    }
    if (gateType === "providers.health") {
      const probes = record(source.probes ?? assertions.probes),
        raws: Evidence<unknown>[] = [],
        providers = [];
      if (Object.keys(probes).length === 0)
        configuration(
          "providers.health requires source.probes mapping metrics/logs/traces to bounded queries or grafana to dashboard uid"
        );
      for (const [name, config] of Object.entries(probes)) {
        const started = now(),
          probeConfig = record(config);
        let raw: Evidence<unknown>;
        if (name === "metrics") raw = await metric(base, probeConfig.query, context);
        else if (name === "logs") raw = await logRecords(base, probeConfig.query, context);
        else if (name === "traces") raw = await traceRecords(base, probeConfig, context);
        else if (name === "grafana" && grafana !== undefined && typeof probeConfig.uid === "string")
          raw = await grafana.getDashboard({
            target: context.targetId,
            uid: probeConfig.uid,
            maximumAgeMs: 600000,
            maximumFutureSkewMs,
            signal: context.signal
          });
        else
          configuration(
            "Provider health probes require a supported provider and explicit read parameters"
          );
        raws.push(raw);
        providers.push({
          name,
          reachable: raw.state === "valid",
          authenticated: raw.state === "valid",
          authorized: raw.state === "valid",
          latencyMs: now() - started,
          maximumLatencyMs: durationMs(assertions.maximum_latency, 5000)
        });
      }
      return [combined(raws, gateType, { providers }), ...raws];
    }
    if (gateType === "telemetry.query_validation") {
      const definitions = [
          ...array(options.policy.gates.pre_deployment),
          ...array(options.policy.gates.post_deployment)
        ].map(record),
        raws: Evidence<unknown>[] = [],
        queries = [];
      for (const gate of definitions) {
        const s = record(gate.source);
        if (typeof s.query !== "string" || !["metrics", "logs"].includes(String(s.provider)))
          continue;
        const raw =
          s.provider === "metrics"
            ? await metric(base, s.query, context)
            : await logRecords(base, s.query, context);
        raws.push(raw);
        const vector = record(raw.value),
          samples = array(vector.samples);
        const mappings = record(
          record(options.policy.identity.provider_mappings)[String(s.provider)]
        );
        const service = String(mappings["service.name"] ?? "service_name"),
          environment = String(mappings["deployment.environment.name"] ?? "deployment_environment");
        const groupBy = [...s.query.matchAll(/(?:by|without)\s*\(([^)]*)\)/gu)].flatMap((match) =>
          String(match[1])
            .split(",")
            .map((v) => v.trim())
        );
        queries.push({
          valid: raw.state === "valid",
          threshold: gate.type === "metric.threshold",
          shape: s.provider === "metrics" && samples.length === 1 ? "scalar" : "records",
          production: record(options.policy.identity.canonical).environment === "production",
          scoped: s.query.includes(`${service}=`) && s.query.includes(`${environment}=`),
          groupBy
        });
      }
      if (raws.length === 0)
        configuration(
          "telemetry.query_validation requires configured telemetry query gates to validate"
        );
      return [combined(raws, gateType, { queries }), ...raws];
    }
    if (gateType === "http.assertion" || gateType === "asset.url") {
      const providerName = string(source.provider) ?? string(source.adapter) ?? "public-probe",
        provider = record(httpProviders[providerName]),
        url = field(source, "url", options.environment);
      if (url === undefined) configuration(`${gateType} requires source.url or source.url_env`);
      const statuses = array(assertions.expected_status ?? assertions.expected_statuses).filter(
        (v): v is number => typeof v === "number"
      );
      const expectedStatuses = statuses.length ? statuses : [200],
        started = now();
      const headers = record(assertions.expected_headers ?? assertions.response_headers),
        json = record(assertions.expected_json ?? assertions.response_json);
      if (gateType === "asset.url") {
        const response = await transport.request({
          url,
          kind: "probe",
          method: "GET",
          timeoutMs: durationMs(provider.timeout, 10000),
          maximumResponseBytes,
          responseType: "text",
          retry: { attempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0, retryStatuses: [] },
          signal: context.signal
        });
        return [
          evidence(
            gateType,
            context,
            new Date(now()).toISOString(),
            {
              reachable: expectedStatuses.includes(response.status),
              scheme: new URL(url).protocol.slice(0, -1),
              nonempty: typeof response.data === "string" && Buffer.byteLength(response.data) > 0
            },
            "http",
            "probe"
          )
        ];
      }
      const raw = await probe.check({
        url,
        method: assertions.method === "HEAD" ? "HEAD" : "GET",
        expectedStatus: expectedStatuses[0] ?? 200,
        expectedHeaders: Object.fromEntries(
          Object.entries(headers).filter((e): e is [string, string] => typeof e[1] === "string")
        ),
        ...(Object.keys(json).length
          ? { expectedJson: json as Readonly<Record<string, string | number | boolean | null>> }
          : {}),
        timeoutMs: durationMs(provider.timeout, 10000),
        maximumResponseBytes,
        signal: context.signal
      });
      return [
        mapped(raw, gateType, {
          status: raw.value?.status,
          expectedStatuses,
          durationMs: now() - started,
          maximumDurationMs: durationMs(assertions.maximum_duration, 10000),
          headersMatch: raw.value?.headersMatch ?? false,
          jsonMatches: raw.value?.jsonMatches ?? true
        })
      ];
    }
    for (const resolver of [
      () => resolveTelemetry(base, gateType, definition, context),
      () => resolveComparison(base, gateType, definition, context),
      () => resolveGrafana(base, grafana, gateType, definition, context),
      () => resolveArtifact(base, gateType, definition, context),
      () => runtime.resolve(gateType, definition, context)
    ]) {
      const resolved = await resolver();
      if (resolved !== undefined) return resolved;
    }
    configuration(
      `${gateType} has no complete evidence acquisition contract; configure a supported adapter and gate-specific source parameters`
    );
  };
  const postGates = array(options.policy.gates.post_deployment)
    .map(record)
    .filter((g) => g.enabled !== false && g.enforcement !== "advisory");
  let generation = 0;
  return {
    resolveEvidence: resolve,
    ...(postGates.length === 0 || options.plan?.phase === "pre_deployment"
      ? {}
      : {
          sample: async (signal: AbortSignal) => {
            const targetId =
                string(options.policy.execution.active_target) ??
                options.plan?.targetId ??
                "active",
              releaseId = string(record(options.policy.identity.canonical).release_id),
              context: Context = {
                phase: "post_deployment",
                targetId,
                ...(releaseId === undefined ? {} : { releaseId }),
                evidenceStore: new EvidenceStore(() => new Date(now())),
                signal,
                clock: () => new Date(now())
              };
            generation += 1;
            if(postGates.some(g=>["runtime.","vm.","kubernetes.","azure_container_apps.","azure_vm."].some(prefix=>String(g.type).startsWith(prefix))||g.type==="telemetry.identity_consistency"))
              await runtime.snapshot(context, true);
            let successful = true;
            for (const gate of postGates) {
              const when = record(gate.when),
                type = activeRuntime(options.policy).type;
              if (
                (typeof when.runtime_type === "string" && when.runtime_type !== type) ||
                (Array.isArray(when.runtime_type) && !when.runtime_type.includes(type))
              )
                continue;
              const raw = await resolve(String(gate.type), gate, context);
              if (raw.length === 0 || raw.some((item) => item.state !== "valid"))
                successful = false;
            }
            return successful && generation > 0;
          }
        })
  };
}
