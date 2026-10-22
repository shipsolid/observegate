import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../../evaluation.js";

function located(
  value: EvidenceRecord,
  name: string,
  passed: boolean,
  message: string,
  observed: unknown,
  path: string,
  expected?: unknown
) {
  const index = typeof value.containerIndex === "number" ? value.containerIndex : 0;
  return assertion(
    name,
    passed,
    message,
    {
      value: observed,
      path: path.replaceAll("containers[0]", `containers[${index}]`),
      document: typeof value.document === "number" ? value.document : 0
    },
    expected
  );
}
function quantity(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)(m|Ki|Mi|Gi|Ti)?$/.exec(value);
  if (match === null) return undefined;
  return (
    Number(match[1]) *
    ({ m: 0.001, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 }[match[2] ?? ""] ?? 1)
  );
}
function limit(value: unknown, replicas: number, round: "up" | "down" = "up"): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== "string" || !/^\d+%$/.test(value)) return undefined;
  const percentage = Number(value.slice(0, -1));
  if (percentage > 100) return undefined;
  return (round === "up" ? Math.ceil : Math.floor)((replicas * percentage) / 100);
}
function protectedByBudget(value: EvidenceRecord, replicas: number): boolean {
  const budget = record(value.disruptionBudget);
  if (
    budget === undefined ||
    (budget.minAvailable !== undefined) === (budget.maxUnavailable !== undefined)
  )
    return false;
  const minimum =
    budget.minAvailable !== undefined
      ? limit(budget.minAvailable, replicas)
      : replicas - (limit(budget.maxUnavailable, replicas) ?? Infinity);
  return minimum !== undefined && minimum >= 1 && minimum <= replicas;
}

export const kubernetesManifestGate = createEvidenceGate({
  type: "kubernetes.manifest",
  description: "Validate immutable, explicit, least-privileged Kubernetes workload manifests.",
  phases: ["pre_deployment"],
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const image = typeof value.image === "string" ? value.image : "";
    const security = record(value.containerSecurityContext) ?? {};
    const digest = image.match(/@(sha256:[a-f0-9]{64})$/iu)?.[1];
    const check = (
      name: string,
      passed: boolean,
      observed: unknown,
      path: string,
      expected?: unknown
    ) => located(value, name, passed, name, observed, path, expected);
    return [
      check(
        "workload exists",
        a.workload_exists === false || value.namespaceExplicit !== undefined,
        value.workloadKind,
        "$.kind"
      ),
      check(
        "container exists",
        a.container_exists === false || image.length > 0,
        image,
        "$.spec.template.spec.containers[0]"
      ),
      check(
        "digest-pinned image",
        a.image_is_digest_pinned === false || digest !== undefined,
        image,
        "$.spec.template.spec.containers[0].image"
      ),
      check(
        "expected image digest",
        typeof value.expectedImageDigest !== "string" || digest === value.expectedImageDigest,
        digest,
        "$.spec.template.spec.containers[0].image",
        value.expectedImageDigest
      ),
      check(
        "forbid latest",
        a.forbid_latest_tag === false || !/(?:^|:)latest(?:@|$)/iu.test(image),
        image,
        "$.spec.template.spec.containers[0].image"
      ),
      check(
        "explicit namespace",
        a.namespace_is_explicit === false || value.namespaceExplicit === true,
        value.namespaceExplicit,
        "$.metadata.namespace",
        true
      ),
      check(
        "not privileged",
        a.forbid_privileged === false || security.privileged !== true,
        security.privileged,
        "$.spec.template.spec.containers[0].securityContext.privileged",
        false
      ),
      check(
        "read-only root filesystem",
        a.read_only_root_filesystem === false || security.readOnlyRootFilesystem === true,
        security.readOnlyRootFilesystem,
        "$.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem",
        true
      )
    ];
  }
});

export const kubernetesProbesGate = createEvidenceGate({
  type: "kubernetes.probes",
  description: "Validate bounded Kubernetes startup, readiness, and liveness probes.",
  phases: ["pre_deployment"],
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const maximum = Number(record(a.timeout_seconds)?.maximum ?? 5);
    const minimum = Number(record(a.failure_threshold)?.minimum ?? 2);
    return ["readiness", "liveness", "startup"].flatMap((name) => {
      const required =
        name === "startup"
          ? (a.startup_probe_required ?? value.startupProbeRequired) === true
          : a[`${name}_probe_required`] !== false;
      const probe = record(value[`${name}Probe`]);
      if (!required && probe === undefined) return [];
      const path = `$.spec.template.spec.containers[0].${name}Probe`;
      return [
        located(
          value,
          `${name} probe`,
          probe !== undefined,
          `${name} probe is configured`,
          probe !== undefined,
          path,
          true
        ),
        located(
          value,
          `${name} timeout`,
          probe !== undefined && Number(probe.timeoutSeconds ?? 1) <= maximum,
          `${name} probe timeout is bounded`,
          probe?.timeoutSeconds ?? 1,
          `${path}.timeoutSeconds`,
          maximum
        ),
        located(
          value,
          `${name} failure threshold`,
          probe !== undefined && Number(probe.failureThreshold ?? 3) >= minimum,
          `${name} probe failure threshold is resilient`,
          probe?.failureThreshold ?? 3,
          `${path}.failureThreshold`,
          minimum
        )
      ];
    });
  }
});

export const kubernetesResourcesGate = createEvidenceGate({
  type: "kubernetes.resources",
  description: "Validate Kubernetes resources, replicas, and disruption protection.",
  phases: ["pre_deployment"],
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const resources = record(value.resources) ?? {};
    const requests = record(resources.requests) ?? {};
    const limits = record(resources.limits) ?? {};
    const results = [
      ...["requests", "limits"].flatMap((kind) => {
        const names =
          a[`${kind}_required`] ?? (kind === "requests" ? ["cpu", "memory"] : ["memory"]);
        return (Array.isArray(names) ? names.map(String) : []).map((name) => {
          const raw = (kind === "requests" ? requests : limits)[name];
          return located(
            value,
            `${name} ${kind}`,
            quantity(raw) !== undefined,
            `${name} ${kind} is declared`,
            raw,
            `$.spec.template.spec.containers[0].resources.${kind}.${name}`
          );
        });
      }),
      ...Object.keys(requests)
        .filter((name) => limits[name] !== undefined)
        .map((name) =>
          located(
            value,
            `${name} request and limit`,
            a.request_must_not_exceed_limit === false ||
              (quantity(requests[name]) !== undefined &&
                quantity(limits[name]) !== undefined &&
                Number(quantity(requests[name])) <= Number(quantity(limits[name]))),
            `${name} request does not exceed its limit`,
            requests[name],
            "$.spec.template.spec.containers[0].resources",
            limits[name]
          )
        )
    ];
    if (value.workloadKind !== "DaemonSet") {
      const replicas = typeof value.replicas === "number" ? value.replicas : 0;
      const minimum = Number(a.production_minimum_replicas ?? 2);
      results.push(
        located(
          value,
          "production replicas",
          value.production !== true || replicas >= minimum,
          "Production workload satisfies replica minimum",
          replicas,
          "$.spec.replicas",
          minimum
        ),
        located(
          value,
          "disruption budget",
          a.disruption_budget_for_multiple_replicas === false ||
            replicas < 2 ||
            protectedByBudget(value, replicas),
          "Multi-replica workload has effective disruption protection",
          value.disruptionBudget,
          "$[PodDisruptionBudget].spec"
        )
      );
    }
    if (
      value.workloadKind === "DaemonSet" &&
      (a.production_minimum_replicas !== undefined ||
        a.disruption_budget_for_multiple_replicas === true)
    )
      results.push(
        located(
          value,
          "controller resource assertions",
          false,
          "DaemonSet scheduling cannot prove replica-count or PDB assertions from static manifests",
          value.workloadKind,
          "$.kind"
        )
      );
    return results;
  }
});

export const kubernetesRolloutStrategyGate = createEvidenceGate({
  type: "kubernetes.rollout_strategy",
  description: "Validate an availability-preserving Kubernetes rollout strategy.",
  phases: ["pre_deployment"],
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const deployment = value.workloadKind === undefined || value.workloadKind === "Deployment";
    const path = deployment ? "$.spec.strategy" : "$.spec.updateStrategy";
    const allowed = Array.isArray(a.allowed_strategies) ? a.allowed_strategies : ["RollingUpdate"];
    const maximum = Number(record(a.max_unavailable)?.less_than_or_equal ?? 1);
    const minimum = Number(record(a.minimum_ready_seconds)?.greater_than_or_equal ?? 5);
    const unavailable =
      value.workloadKind === "DaemonSet" && typeof value.maxUnavailable === "string"
        ? undefined
        : limit(value.maxUnavailable, Number(value.replicas ?? 1), deployment ? "down" : "up");
    const results = [
      located(
        value,
        "strategy",
        allowed.includes(value.strategy),
        "Workload uses an allowed strategy",
        value.strategy,
        `${path}.type`,
        allowed
      ),
      located(
        value,
        "maximum unavailable",
        value.strategy !== "RollingUpdate" || (unavailable !== undefined && unavailable <= maximum),
        "Unavailable replicas are within policy",
        value.maxUnavailable,
        `${path}.rollingUpdate.maxUnavailable`,
        maximum
      ),
      located(
        value,
        "minimum ready seconds",
        typeof value.minimumReadySeconds === "number" && value.minimumReadySeconds >= minimum,
        "Minimum ready duration satisfies policy",
        value.minimumReadySeconds,
        "$.spec.minReadySeconds",
        minimum
      )
    ];
    if (deployment || a.progress_deadline_required === true)
      results.push(
        located(
          value,
          "progress deadline",
          a.progress_deadline_required === false ||
            (typeof value.progressDeadlineSeconds === "number" &&
              value.progressDeadlineSeconds > 0),
          "Progress deadline is declared",
          value.progressDeadlineSeconds,
          "$.spec.progressDeadlineSeconds"
        )
      );
    if (value.workloadKind === "StatefulSet")
      results.push(
        located(
          value,
          "partition",
          value.partition === undefined || value.partition === 0,
          "All StatefulSet replicas participate in rollout",
          value.partition,
          "$.spec.updateStrategy.rollingUpdate.partition",
          0
        )
      );
    return results;
  }
});
