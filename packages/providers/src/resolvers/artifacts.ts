import { parseAllDocuments } from "yaml";
import { parseContainerAppManifest } from "../runtime/azure/container-apps.js";
import { parseKubernetesManifest } from "../runtime/kubernetes/manifest.js";
import { parseSarifEvidence } from "../evidence/sarif.js";
import { parseIncidentEvidence } from "../evidence/incidents.js";
import { parseOtlpContract } from "../evidence/otlp-contract.js";
import { parseSyntheticEvidence } from "../evidence/synthetic.js";
import {
  activeRuntime,
  array,
  configuration,
  durationMs,
  evidence,
  field,
  identity,
  invalid,
  loadFiles,
  record,
  string,
  type Context,
  type Data,
  type ResolverBase
} from "./shared.js";
import type { Evidence } from "@observability-gate/core";

function yaml(content: string): readonly Data[] {
  const docs = parseAllDocuments(content, { uniqueKeys: true });
  if (docs.some((d) => d.errors.length)) invalid("Artifact YAML is invalid");
  return docs.map((d) => record(d.toJS({ maxAliasCount: 0 })));
}
function envFrom(resources: readonly Data[]): Data {
  const containers = resources.flatMap((r) => {
    const spec = record(record(r.properties).template ?? record(record(r.spec).template).spec);
    return array(spec.containers).map(record);
  });
  return Object.fromEntries(
    containers.flatMap((c) =>
      array(c.env)
        .map(record)
        .filter((e) => typeof e.name === "string" && typeof e.value === "string")
        .map((e) => [String(e.name), e.value])
    )
  );
}
function serviceDefinition(content: string, windows: boolean): Data {
  if (windows) {
    let parsed: Data;
    try {
      parsed = record(JSON.parse(content));
    } catch {
      return invalid("Windows service definition is not JSON");
    }
    const keys = [
      "automaticRestart",
      "restartDelaySeconds",
      "startupTimeoutSeconds",
      "gracefulShutdownSeconds",
      "identity",
      "telemetryAgentDependency",
      "serviceVersionDeclared"
    ];
    return Object.fromEntries(keys.map((k) => [k, parsed[k]]));
  }
  const values = new Map<string, string[]>();
  for (const line of content.split(/\r?\n/u)) {
    const m = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/u.exec(line.trim());
    if (m) values.set(String(m[1]), [...(values.get(String(m[1])) ?? []), String(m[2])]);
  }
  for (const [key, items] of values)
    if (
      key.startsWith("Exec") &&
      items.some((v) => /(?:\||&&|;|>|<|\$\(|`|\b(?:sh|bash|pwsh|powershell)\s+-c\b)/u.test(v))
    )
      invalid("Service definition contains prohibited shell execution");
  const numeric = (key: string) => {
    const v = values.get(key)?.[0];
    return v === undefined ? undefined : Number(v.replace(/s$/u, ""));
  };
  return {
    automaticRestart: ["always", "on-failure"].includes(values.get("Restart")?.[0] ?? ""),
    restartDelaySeconds: numeric("RestartSec"),
    startupTimeoutSeconds: numeric("TimeoutStartSec"),
    gracefulShutdownSeconds: numeric("TimeoutStopSec"),
    identity: values.get("User")?.[0],
    telemetryAgentDependency: /(?:alloy|otelcol)/iu.test(
      [...(values.get("After") ?? []), ...(values.get("Requires") ?? [])].join(" ")
    ),
    serviceVersionDeclared: (values.get("Environment") ?? []).some((v) =>
      v.includes("OTEL_SERVICE_VERSION=")
    )
  };
}
export async function resolveArtifact(
  base: ResolverBase,
  kind: string,
  definition: Data,
  context: Context
): Promise<readonly Evidence<unknown>[] | undefined> {
  const source = record(definition.source),
    a = record(definition.assertions),
    runtime = activeRuntime(base.policy),
    artifacts = record(runtime.artifacts),
    at = new Date(base.now()).toISOString();
  let value: unknown;
  if (kind === "identity.contract") value = identity(base.policy);
  else if (kind === "policy.self_check") {
    const all = [
        ...array(base.policy.gates.pre_deployment),
        ...array(base.policy.gates.post_deployment)
      ].map(record),
      ids = all.map((g) => g.id);
    const sections = ["identity", "targets", "providers", "reporting", "security"].filter((key) =>
      Object.prototype.hasOwnProperty.call(base.policy, key)
    );
    for (const phase of ["pre_deployment", "post_deployment"])
      if (Array.isArray(base.policy.gates[phase])) sections.push(`gates.${phase}`);
    const secretCount = (v: unknown): number =>
      Object.entries(record(v)).reduce(
        (n, [k, x]) =>
          n +
          (typeof x === "object"
            ? secretCount(x)
            : /(?:password|secret|token)$/iu.test(k) &&
                !k.endsWith("_env") &&
                typeof x === "string" &&
                x.length > 0
              ? 1
              : 0),
        0
      );
    value = {
      sections,
      uniqueGateIds: ids.every((v) => typeof v === "string") && new Set(ids).size === ids.length,
      unknownFields: Object.keys(base.policy).filter(
        (k) =>
          ![
            "metadata",
            "execution",
            "identity",
            "release",
            "observation",
            "decision",
            "targets",
            "providers",
            "gate_defaults",
            "gates",
            "reporting",
            "security",
            "limits"
          ].includes(k)
      ).length,
      inlineSecrets: secretCount(base.policy),
      blockingPostGates: array(base.policy.gates.post_deployment)
        .map(record)
        .filter((g) => g.enabled !== false && g.enforcement !== "advisory").length
    };
  } else if (kind === "policy.coverage") {
    const gates = array(base.policy.gates.post_deployment)
      .map(record)
      .filter((g) => g.enabled !== false && g.enforcement !== "advisory");
    const types: Record<string, string> = {
      "runtime.release_identity": "workload_identity",
      "runtime.ready": "workload_readiness",
      "telemetry.presence": "telemetry_presence",
      "telemetry.freshness": "telemetry_freshness",
      "grafana.slo_status": "slo_or_error_budget",
      "grafana.error_budget": "slo_or_error_budget",
      "grafana.alert_state": "active_alerts"
    };
    value = {
      categories: [
        ...new Set(
          gates
            .flatMap((g) => [
              types[String(g.type)],
              g.category,
              String(g.type).startsWith("comparison.") ? "regression" : undefined
            ])
            .filter((x): x is string => typeof x === "string")
        )
      ],
      platformSpecific: gates.some((g) =>
        String(g.type).startsWith(
          runtime.type === "kubernetes"
            ? "kubernetes."
            : runtime.type === "azure_container_apps"
              ? "azure_container_apps."
              : "vm."
        )
      )
    };
  } else if (kind === "policy.change_window") {
    const fileConfig =
      typeof source.file === "string"
        ? (yaml((await loadFiles(base, definition))[0].content.toString("utf8"))[0] ?? {})
        : {};
    const timezone = string(definition.timezone ?? a.timezone ?? fileConfig.timezone),
      freezes = array(definition.freezes ?? a.freezes ?? fileConfig.freezes);
    if (
      timezone === undefined ||
      !(
        Array.isArray(definition.freezes) ||
        Array.isArray(a.freezes) ||
        Array.isArray(fileConfig.freezes)
      )
    )
      configuration(
        "policy.change_window requires an explicit IANA timezone and freezes array with start/end instants"
      );
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(base.now()));
    } catch {
      return configuration("policy.change_window timezone must be a supported IANA timezone");
    }
    const active = freezes.map(record).some((f) => {
      const start = Date.parse(String(f.start)),
        end = Date.parse(String(f.end));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        configuration(
          "Freeze windows require valid absolute start/end timestamps including timezone"
        );
      return base.now() >= start && base.now() < end;
    });
    const exception = record(definition.exception ?? a.exception);
    const exceptionId =
      field(exception, "environment_variable", base.environment) ??
      base.environment[String(exception.environment_variable ?? "")] ??
      exception.id;
    const exceptionReason =
      base.environment[String(exception.require_reason_env ?? "")] ?? exception.reason;
    const exceptionApprover =
      base.environment[String(exception.require_approver_env ?? "")] ?? exception.approver;
    value = {
      freezeActive: active,
      exceptionApproved:
        exception.approved === true ||
        (typeof exceptionId === "string" &&
          typeof exceptionReason === "string" &&
          typeof exceptionApprover === "string"),
      exceptionId,
      exceptionReason,
      exceptionApprover
    };
  } else if (kind === "asset.metadata") {
    const files = await loadFiles(base, definition);
    const resources = files
      .filter((f) => !/CODEOWNERS$/u.test(f.relativePath))
      .flatMap((f) => yaml(f.content.toString("utf8")));
    const owner =
      resources.map((r) => record(r.spec).owner).find((v) => typeof v === "string") ??
      files
        .filter((f) => /CODEOWNERS$/u.test(f.relativePath))
        .flatMap((f) => f.content.toString("utf8").split(/\r?\n/u))
        .find((l) => /^\*\s+@/u.test(l))
        ?.split(/\s+/u)[1];
    const annotations = resources.map((r) => record(record(r.metadata).annotations));
    value = {
      owner,
      escalationContact: annotations
        .map(
          (v) =>
            v["observability-gate/escalation-contact"] ??
            v["pagerduty.com/service-id"] ??
            v["grafana.com/oncall-url"]
        )
        .find((v) => typeof v === "string")
    };
  } else if (kind.startsWith("kubernetes.") && context.phase === "pre_deployment") {
    const files = await loadFiles(base, definition, array(artifacts.rendered_manifests));
    const workload = record(runtime.workload),
      name = field(workload, "name", base.environment),
      namespace = field(runtime, "namespace", base.environment),
      workloadKind = string(workload.kind),
      container = field(workload, "container", base.environment);
    if (workload.container_env !== undefined && container === undefined)
      configuration("Kubernetes workload.container_env must resolve to a container name");
    if (
      name === undefined ||
      namespace === undefined ||
      !["Deployment", "StatefulSet", "DaemonSet"].includes(workloadKind ?? "")
    )
      configuration(
        "Kubernetes artifact gates require active runtime workload.kind/name and namespace"
      );
    const parsed = parseKubernetesManifest(
      files.map((f) => f.content.toString("utf8")).join("\n---\n"),
      {
        kind: workloadKind as "Deployment" | "StatefulSet" | "DaemonSet",
        name,
        namespace,
        ...(container === undefined ? {} : { container })
      }
    );
    value = {
      ...parsed,
      production: record(base.policy.identity.canonical).environment === "production",
      expectedImageDigest:
        field(a, "image_digest", base.environment) ??
        field(record(runtime.expected), "image_digest", base.environment),
      startupProbeRequired: a.startup_probe_required === true
    };
  } else if (
    (kind.startsWith("azure_container_apps.") && context.phase === "pre_deployment") ||
    kind === "artifact.instrumentation_configuration"
  ) {
    const files = await loadFiles(
      base,
      definition,
      kind === "artifact.instrumentation_configuration"
        ? [
            ...array(artifacts.rendered_manifests),
            ...array(artifacts.rendered_configuration),
            ...array(artifacts.service_definition)
          ]
        : array(artifacts.rendered_configuration)
    );
    const resources = files.flatMap((f) => yaml(f.content.toString("utf8"))),
      environment = envFrom(resources);
    if (kind === "artifact.instrumentation_configuration") {
      const attributes = Object.fromEntries(
        String(environment.OTEL_RESOURCE_ATTRIBUTES ?? "")
          .split(",")
          .map((pair) => pair.split("=", 2))
      );
      const endpoint = string(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
      let plaintextRemote = false;
      if (endpoint !== undefined) {
        let url: URL;
        try {
          url = new URL(endpoint);
        } catch {
          return invalid("OTLP endpoint in artifact is invalid");
        }
        plaintextRemote =
          url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      }
      value = {
        serviceName: environment.OTEL_SERVICE_NAME ?? attributes["service.name"],
        serviceVersion: environment.OTEL_SERVICE_VERSION ?? attributes["service.version"],
        environment:
          attributes["deployment.environment.name"] ?? environment.OTEL_DEPLOYMENT_ENVIRONMENT,
        otlpConfigured: endpoint !== undefined,
        metrics: environment.OTEL_METRICS_EXPORTER === "otlp",
        logs: environment.OTEL_LOGS_EXPORTER === "otlp",
        traces: environment.OTEL_TRACES_EXPORTER === "otlp",
        debugExporter: Object.values(environment).some((v) => v === "console" || v === "debug"),
        plaintextRemote,
        hardcodedCredentials: Object.entries(environment).some(
          ([k, v]) =>
            /(?:TOKEN|PASSWORD|SECRET|HEADERS)$/u.test(k) && typeof v === "string" && v.length > 0
        )
      };
    } else value = parseContainerAppManifest(files[0].content.toString("utf8"));
  } else if (kind === "vm.service_definition" || kind === "vm.release_identity") {
    const files = await loadFiles(base, definition, array(artifacts.service_definition));
    const parsed = serviceDefinition(
      files[0].content.toString("utf8"),
      runtime.operating_system === "windows"
    );
    value =
      kind === "vm.service_definition"
        ? parsed
        : {
            artifactDigest: field(record(runtime.expected), "artifact_digest", base.environment),
            releaseMarker: field(record(runtime.expected), "release_marker", base.environment),
            serviceVersion:
              parsed.serviceVersionDeclared === true
                ? record(base.policy.identity.canonical).release_id
                : undefined,
            rollbackArtifact: field(record(runtime.expected), "rollback_artifact", base.environment)
          };
  } else if (
    [
      "evidence.sarif",
      "evidence.incident_state",
      "evidence.otlp_contract",
      "synthetic.result",
      "deployment.concurrency",
      "synthetic.plan",
      "telemetry.pipeline_configuration",
      "telemetry.contract"
    ].includes(kind)
  ) {
    const files = await loadFiles(base, definition);
    const content = files[0].content;
    if (kind === "evidence.sarif")
      value = parseSarifEvidence(content, {
        acceptedRulePrefixes: array(a.accepted_rule_families).map(String)
      });
    else if (kind === "evidence.incident_state") value = parseIncidentEvidence(content);
    else if (kind === "evidence.otlp_contract")
      value = parseOtlpContract(
        content,
        {
          commit: String(record(base.policy.identity.canonical).release_id ?? ""),
          workflow: String(record(base.policy.identity.canonical).deployment_id ?? "")
        },
        {
          forbiddenFields: [
            ...array(a.forbid_sensitive_fields),
            ...array(a.forbid_metric_labels)
          ].map(String)
        }
      );
    else if (kind === "synthetic.result") {
      const parsed = parseSyntheticEvidence(content);
      const headers = record(a.release_identity_header);
      value = {
        requiredTests: array(a.required_tests),
        tests: parsed.tests.map((t) => ({
          name: t.name,
          passed: t.status === "passed",
          durationMs: t.durationMs,
          maximumDurationMs: durationMs(
            typeof a.maximum_duration === "string"
              ? a.maximum_duration
              : record(a.maximum_duration)[t.name],
            Infinity
          ),
          releaseHeader: t.observedRelease,
          expectedReleaseHeader: headers.equals ?? context.releaseId
        }))
      };
    } else {
      let root: Data;
      try {
        root = yaml(content.toString("utf8"))[0] ?? {};
      } catch {
        return invalid(`${kind} requires a JSON artifact`);
      }
      if (kind === "deployment.concurrency") {
        if (
          !Array.isArray(root.deployments) ||
          array(root.deployments).some(
            (v) => typeof record(v).id !== "string" || typeof record(v).active !== "boolean"
          )
        )
          invalid("Deployment evidence requires deployments with id and active");
        value = {
          deployments: root.deployments,
          currentDeploymentId: record(base.policy.identity.canonical).deployment_id
        };
      } else if (kind === "synthetic.plan") {
        const checks = array(root.checks).map(record);
        if (checks.length === 0) invalid("Synthetic plan requires a nonempty checks array");
        value = {
          exists: true,
          timeoutMs: Math.max(...checks.map((c) => durationMs(c.timeout, Infinity))),
          successAssertion: checks.every((c) => array(c.expected_status).length > 0),
          releaseAssertion: checks.every((c) => typeof c.expected_release === "string"),
          logsSecrets: checks.some((c) => c.log_secrets === true)
        };
      } else if (kind === "telemetry.pipeline_configuration") {
        const pipelines = record(record(root.service).pipelines),
          processors = record(root.processors),
          exporters = record(root.exporters);
        value = {
          receiver: Object.keys(record(root.receivers)).length > 0,
          processors: Object.keys(processors).map((v) => v.split("/")[0]),
          exporters: Object.keys(pipelines).filter(
            (signal) => array(record(pipelines[signal]).exporters).length > 0
          ),
          retry: Object.values(exporters).every(
            (v) => record(record(v).retry_on_failure).enabled === true
          ),
          sendingQueue: Object.values(exporters).every(
            (v) => record(record(v).sending_queue).enabled === true
          ),
          tls: Object.values(exporters).every(
            (v) =>
              typeof record(v).endpoint === "string" &&
              String(record(v).endpoint).startsWith("https://") &&
              record(record(v).tls).insecure !== true
          )
        };
      } else
        configuration(
          "telemetry.contract requires live raw OTLP fields beyond normalized summaries; configure evidence.otlp_contract for offline capture validation or explicit live signal queries"
        );
    }
    return [
      evidence(
        kind,
        context,
        files[0].modifiedAt,
        value,
        string(source.provider) ?? "evidence",
        kind
      )
    ];
  } else return undefined;
  return [evidence(kind, context, at, value)];
}
