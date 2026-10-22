import type { ExecutionPlan, PlannedGate, ProviderRequirement } from "@observability-gate/core";
import type { ProviderPolicy } from "../session.js";
import { activeRuntime, array, record, string, type Data } from "./shared.js";

/** Validate acquisition contracts without reading files, resolving credentials, or making requests. */
export function validateProviderAcquisition(
  policy: ProviderPolicy,
  phase: "pre_deployment" | "post_deployment"
): readonly string[] {
  const errors: string[] = [],
    runtime = activeRuntime(policy),
    gates = array(policy.gates[phase]).map(record),
    providers = record(policy.providers.telemetry);
  const hasFiles = (gate: Data) => {
    const s = record(gate.source);
    return (
      typeof s.file === "string" ||
      array(s.files).length > 0 ||
      array(record(record(policy.providers.evidence)[String(s.provider)]).files).length > 0
    );
  };
  for (const [name, configuration] of Object.entries(providers)) {
    const compatible: Readonly<Record<string, readonly string[]>> = {
      metrics: ["prometheus", "mimir"],
      logs: ["loki"],
      traces: ["tempo"],
      grafana: ["grafana"]
    };
    const type = record(configuration).type;
    if (
      compatible[name] === undefined ||
      (type !== undefined && !compatible[name]?.includes(String(type)))
    )
      errors.push(
        `providers.telemetry.${name}: use the canonical metrics/logs/traces/grafana key with its matching provider type`
      );
  }
  for (const gate of gates) {
    if (gate.enabled === false) continue;
    const when = record(gate.when),
      types = array(when.runtime_type);
    if (
      (typeof when.runtime_type === "string" && when.runtime_type !== runtime.type) ||
      (types.length > 0 && !types.includes(runtime.type)) ||
      (when.operating_system !== undefined && when.operating_system !== runtime.operating_system)
    )
      continue;
    const kind = String(gate.type),
      source = record(gate.source),
      a = record(gate.assertions),
      queries = record(source.queries ?? a.queries),
      add = (text: string) => errors.push(`${String(gate.id ?? kind)}: ${text}`);
    const runtimeGate =
      [
        "runtime.provisioned",
        "runtime.ready",
        "runtime.release_identity",
        "runtime.stability",
        "telemetry.identity_consistency"
      ].includes(kind) ||
      ((kind.startsWith("vm.") ||
        kind.startsWith("kubernetes.") ||
        kind.startsWith("azure_container_apps.") ||
        kind === "azure_vm.instance_view") &&
        phase === "post_deployment");
    if (
      runtimeGate &&
      ![
        "kubernetes",
        "azure_container_apps",
        "azure_vm",
        "linux_vm",
        "windows_vm",
        "generic_vm"
      ].includes(String(runtime.type))
    )
      add(
        "requires a runtime with a snapshot adapter; generic targets support evidence/telemetry gates only"
      );
    if (
      runtimeGate &&
      ["linux_vm", "windows_vm", "generic_vm"].includes(String(runtime.type)) &&
      (array(runtime.expected_hosts).length === 0 ||
        array(record(runtime.artifacts).runtime_evidence).length === 0)
    )
      add(
        "VM snapshots require runtime.expected_hosts and artifacts.runtime_evidence with measured host/service/agent/release facts"
      );
    if (kind === "runtime.release_identity") {
      const signature = record(record(record(policy.providers.evidence).deployment).signature);
      const keySources = [signature.jwks_file, signature.jwks_url, signature.jwks_url_env].filter(
        (value) => typeof value === "string" && value.length > 0
      );
      if (keySources.length !== 1)
        add(
          "requires exactly one trusted deployment signature JWKS source: jwks_file, jwks_url or jwks_url_env"
        );
    }
    if (kind === "metric.threshold") {
      if (typeof source.query !== "string")
        add("source.query must be an explicit bounded metric query");
      if (
        (a.minimum_requests !== undefined || a.minimum_total_requests !== undefined) &&
        typeof source.request_count_query !== "string" &&
        typeof queries.requests !== "string"
      )
        add(
          "minimum_requests requires source.request_count_query; sample count cannot measure request count"
        );
    }
    if (
      [
        "telemetry.collector_health",
        "metric.multi_threshold",
        "runtime.capacity",
        "telemetry.cardinality_estimate",
        "telemetry.volume_estimate"
      ].includes(kind) &&
      Object.keys(queries).length === 0
    )
      add("requires explicit source.queries or assertions.queries for measured quantities");
    if (kind === "telemetry.cardinality_estimate" || kind === "telemetry.volume_estimate") {
      const limits = kind === "telemetry.volume_estimate" ? record(a.estimated_growth_percent) : a;
      if (Object.keys(limits).length === 0)
        add("requires at least one per-dimension budget assertion");
      if (source.provider !== "metrics") add("requires source.provider metrics");
      for (const name of Object.keys(limits))
        if (typeof record(source.queries)[name] !== "string")
          add(`requires source.queries.${name} for the configured budget`);
      for (const name of Object.keys(queries))
        if (limits[name] === undefined)
          add(`measurement ${name} requires its matching budget assertion`);
    }
    if (
      ["telemetry.freshness", "telemetry.identity_consistency", "telemetry.correlation"].includes(
        kind
      )
    ) {
      if (kind !== "telemetry.correlation" && typeof queries.metrics !== "string")
        add("requires source.queries.metrics");
      if (typeof queries.logs !== "string") add("requires source.queries.logs");
    }
    if (
      kind === "telemetry.service_graph" &&
      typeof source.caller !== "string" &&
      typeof a.expected_caller !== "string"
    )
      add(
        "requires source.caller or assertions.expected_caller; a trace result alone does not prove a caller relationship"
      );
    if (kind.startsWith("comparison.")) {
      const baseline = record(source.baseline ?? gate.baseline);
      if (
        (baseline.release_id === undefined || baseline.release_id === "release.baseline") &&
        typeof record(policy.release.baseline).explicit_release_id !== "string"
      )
        add("requires an explicit distinct baseline release ID");
      if (
        kind === "comparison.metric" &&
        ((typeof record(source.candidate).query !== "string" &&
          typeof source.candidate_query !== "string") ||
          (typeof record(source.baseline).query !== "string" &&
            typeof source.baseline_query !== "string"))
      )
        add(
          "requires candidate.query and baseline.query; metric aliases do not define backend queries"
        );
      if (
        ["comparison.multi_metric", "comparison.telemetry_volume"].includes(kind) &&
        Object.keys(record(source.queries)).length === 0
      )
        add(
          "requires source.queries entries containing candidate/baseline queries and independent request_count_query"
        );
    }
    if (
      kind === "grafana.burn_rate" &&
      !array(a.windows).every(
        (w) => typeof record(w).short_query === "string" && typeof record(w).long_query === "string"
      )
    )
      add(
        "each assertions.windows pair requires short_query and long_query; a single normalized burn value cannot substitute both windows"
      );
    if (kind === "grafana.slo_status" && typeof queries.status !== "string")
      add("requires source.queries.status measured SLO status");
    if (kind === "grafana.error_budget" && typeof queries.remaining_percent !== "string")
      add("requires source.queries.remaining_percent measured error budget");
    if (
      kind === "grafana.error_budget" &&
      (a.maximum_consumed_during_release_percent !== undefined ||
        a.consumed_during_release_percent !== undefined) &&
      typeof queries.release_consumed_percent !== "string"
    )
      add("release-specific consumption requires source.queries.release_consumed_percent");
    if (
      kind === "telemetry.contract" &&
      (!hasFiles(gate) || typeof queries.metrics !== "string" || typeof queries.logs !== "string")
    )
      add(
        "telemetry.contract requires provenance-bound source.files capture and live source.queries.metrics/logs with traces provider"
      );
    if (
      [
        "evidence.sarif",
        "evidence.incident_state",
        "evidence.otlp_contract",
        "synthetic.result",
        "asset.metadata",
        "synthetic.plan",
        "telemetry.pipeline_configuration",
        "deployment.concurrency"
      ].includes(kind) &&
      !hasFiles(gate) &&
      !(
        kind === "deployment.concurrency" &&
        source.provider === "metrics" &&
        typeof source.query === "string"
      )
    )
      add("requires source.files or a configured evidence provider with files");
    if (
      kind === "policy.change_window" &&
      typeof source.file !== "string" &&
      (typeof (gate.timezone ?? a.timezone) !== "string" ||
        !Array.isArray(gate.freezes ?? a.freezes))
    )
      add("requires explicit timezone and freezes with absolute start/end timestamps");
    if (kind === "providers.health" && Object.keys(record(source.probes ?? a.probes)).length === 0)
      add(
        "requires source.probes mapping providers to bounded read query or Grafana dashboard uid"
      );
    if (
      kind === "azure_container_apps.replica_health" &&
      (typeof queries.activation_failures !== "string" ||
        typeof queries.deactivation_failures !== "string")
    )
      add(
        "requires source.queries activation_failures and deactivation_failures; runtime snapshots do not expose lifecycle counters"
      );
    if (
      ((kind.startsWith("runtime.") && kind !== "runtime.capacity") ||
        kind.startsWith("kubernetes.") ||
        kind.startsWith("azure_container_apps.") ||
        kind === "azure_vm.instance_view") &&
      typeof runtime.type !== "string"
    )
      add("requires execution.active_target referencing a runtime definition");
    const provider = string(source.provider);
    if (
      provider !== undefined &&
      ["metrics", "logs", "traces", "grafana"].includes(provider) &&
      Object.keys(record(providers[provider])).length === 0
    )
      add(`requires providers.telemetry.${provider}`);
  }
  return Object.freeze(errors);
}

export function bindAcquisitionPlan(policy: ProviderPolicy, plan: ExecutionPlan): ExecutionPlan {
  const runtime = activeRuntime(policy),
    runtimeRequirement: ProviderRequirement =
      runtime.type === "kubernetes"
        ? { provider: "kubernetes", capability: "runtime.snapshot", required: true }
        : runtime.type === "azure_container_apps"
          ? { provider: "azure", capability: "container-apps.snapshot", required: true }
          : runtime.type === "azure_vm"
            ? { provider: "azure", capability: "virtual-machine.instance-view", required: true }
            : { provider: "evidence", capability: "vm.snapshot", required: true };
  const telemetry: Record<string, string> = {
    metrics: "metrics.query.instant",
    logs: "logs.query.range",
    traces: "traces.search"
  };
  const requirement = (provider: string, capability: string): ProviderRequirement => ({
    provider,
    capability,
    required: true
  });
  const forGate = (gate: PlannedGate): readonly ProviderRequirement[] => {
    const kind = gate.type,
      source = record(gate.definition.source);
    if (kind === "http.assertion" || kind === "asset.url") return [requirement("http", "probe")];
    if (kind.startsWith("grafana."))
      return [
        requirement(
          "grafana",
          kind === "grafana.dashboard"
            ? "dashboard.read"
            : kind === "grafana.notification_policy"
              ? "alerting.policies.read"
              : kind === "grafana.alert_state"
                ? "alerting.state.read"
                : kind.startsWith("grafana.alert")
                  ? "alerting.rules.read"
                  : "slo.read"
        ),
        ...(kind === "grafana.burn_rate" ? [requirement("metrics", "metrics.query.instant")] : [])
      ];
    if (kind.startsWith("comparison."))
      return [
        requirement(
          kind === "comparison.trace_metrics" ? "traces" : "metrics",
          kind === "comparison.trace_metrics" ? "traces.search" : "metrics.query.instant"
        )
      ];
    if (kind === "providers.health")
      return Object.keys(record(source.probes ?? record(gate.definition.assertions).probes)).map(
        (p) => requirement(p, p === "grafana" ? "dashboard.read" : (telemetry[p] ?? p))
      );
    if (kind === "telemetry.correlation")
      return [requirement("logs", "logs.query.range"), requirement("traces", "traces.search")];
    if (
      kind === "telemetry.freshness" ||
      kind === "telemetry.identity_consistency" ||
      kind === "telemetry.contract"
    )
      return [
        requirement("metrics", "metrics.query.instant"),
        requirement("logs", "logs.query.range"),
        requirement("traces", "traces.search"),
        ...(kind === "telemetry.identity_consistency"
          ? [runtimeRequirement, requirement("deployment", "deployment.verified")]
          : [])
      ];
    if (kind === "runtime.release_identity")
      return [
        runtimeRequirement,
        requirement("deployment", "deployment.verified"),
        ...(typeof source.runtime_release_query === "string"
          ? [requirement("metrics", "metrics.query.instant")]
          : [])
      ];
    if (kind === "deployment.concurrency" && source.provider === "metrics")
      return [requirement("metrics", "metrics.query.instant")];
    if (
      kind === "metric.threshold" &&
      (typeof gate.definition.window === "string" ||
        Number(record(gate.definition.assertions).minimum_samples) > 1)
    )
      return [
        requirement("metrics", "metrics.query.range"),
        ...(source.request_count_query === undefined
          ? []
          : [requirement("metrics", "metrics.query.instant")])
      ];
    if (
      kind === "runtime.capacity" ||
      kind === "metric.multi_threshold" ||
      kind.startsWith("metric.") ||
      kind === "telemetry.collector_health" ||
      kind === "telemetry.cardinality_estimate" ||
      kind === "telemetry.volume_estimate" ||
      kind === "dependency.health"
    )
      return [requirement("metrics", "metrics.query.instant")];
    if (kind === "telemetry.presence")
      return [requirement(String(source.provider), telemetry[String(source.provider)] ?? kind)];
    if (kind === "telemetry.service_graph") return [requirement("traces", "traces.search")];
    if (kind.startsWith("vm.") && plan.phase === "post_deployment")
      return [requirement("evidence", "vm.snapshot")];
    if (kind === "azure_container_apps.replica_health")
      return [runtimeRequirement, requirement("metrics", "metrics.query.instant")];
    if (
      ((kind.startsWith("runtime.") ||
        kind.startsWith("vm.") ||
        kind.startsWith("kubernetes.") ||
        kind.startsWith("azure_container_apps.") ||
        kind === "azure_vm.instance_view") &&
        plan.phase === "post_deployment") ||
      kind === "vm.capacity"
    )
      return [runtimeRequirement];
    if (
      [
        "evidence.sarif",
        "evidence.incident_state",
        "evidence.otlp_contract",
        "synthetic.result",
        "synthetic.plan",
        "deployment.concurrency",
        "telemetry.pipeline_configuration"
      ].includes(kind)
    )
      return [requirement(string(source.provider) ?? "evidence", kind)];
    return [requirement("policy", kind)];
  };
  const gates = plan.gates.map((gate) => ({ ...gate, providerRequirements: forGate(gate) }));
  const requirements = new Map<string, ProviderRequirement>();
  for (const gate of gates.filter((g) => g.applicability === "applicable"))
    for (const r of gate.providerRequirements) requirements.set(`${r.provider}:${r.capability}`, r);
  return { ...plan, gates, requiredProviders: [...requirements.values()] };
}
