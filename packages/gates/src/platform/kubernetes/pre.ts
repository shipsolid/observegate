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
  return assertion(
    name,
    passed,
    message,
    { value: observed, path, document: typeof value.document === "number" ? value.document : 0 },
    expected
  );
}

function quantity(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const match = /^(\d+(?:\.\d+)?)(m|Ki|Mi|Gi|Ti)?$/.exec(value);
  if (match === null) return undefined;
  const amount = Number(match[1]);
  const multiplier =
    { m: 0.001, Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4 }[match[2] ?? ""] ?? 1;
  return amount * multiplier;
}

export const kubernetesManifestGate = createEvidenceGate({
  type: "kubernetes.manifest",
  description: "Validate immutable, explicit, least-privileged Kubernetes workload manifests.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const image = typeof value.image === "string" ? value.image : "";
    const security = record(value.containerSecurityContext) ?? {};
    const digest = image.match(/@(sha256:[a-f0-9]{64})$/iu)?.[1];
    return [
      located(
        value,
        "digest-pinned image",
        digest !== undefined,
        "Container image is pinned by sha256 digest",
        image,
        "$.spec.template.spec.containers[0].image"
      ),
      located(
        value,
        "expected image digest",
        typeof value.expectedImageDigest !== "string" || digest === value.expectedImageDigest,
        "Container image matches the expected release digest",
        digest,
        "$.spec.template.spec.containers[0].image",
        value.expectedImageDigest
      ),
      located(
        value,
        "forbid latest",
        !/(?:^|:)latest(?:@|$)/iu.test(image),
        "Container image does not use the latest tag",
        image,
        "$.spec.template.spec.containers[0].image"
      ),
      located(
        value,
        "explicit namespace",
        value.namespaceExplicit === true,
        "Workload namespace is explicit",
        value.namespaceExplicit,
        "$.metadata.namespace",
        true
      ),
      located(
        value,
        "not privileged",
        security.privileged !== true,
        "Container is not privileged",
        security.privileged,
        "$.spec.template.spec.containers[0].securityContext.privileged",
        false
      ),
      located(
        value,
        "read-only root filesystem",
        security.readOnlyRootFilesystem === true,
        "Container root filesystem is read-only",
        security.readOnlyRootFilesystem,
        "$.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem",
        true
      )
    ];
  }
});

function probeAssertions(value: EvidenceRecord, name: string, probeValue: unknown) {
  const probe = record(probeValue);
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
      probe !== undefined && Number(probe.timeoutSeconds ?? 1) <= 5,
      `${name} probe timeout is bounded`,
      probe?.timeoutSeconds ?? 1,
      `${path}.timeoutSeconds`,
      5
    ),
    located(
      value,
      `${name} failure threshold`,
      probe !== undefined && Number(probe.failureThreshold ?? 3) >= 2,
      `${name} probe failure threshold is resilient`,
      probe?.failureThreshold ?? 3,
      `${path}.failureThreshold`,
      2
    )
  ];
}

export const kubernetesProbesGate = createEvidenceGate({
  type: "kubernetes.probes",
  description: "Validate bounded Kubernetes startup, readiness, and liveness probes.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const results = [
      ...probeAssertions(value, "readiness", value.readinessProbe),
      ...probeAssertions(value, "liveness", value.livenessProbe)
    ];
    if (value.startupProbeRequired === true)
      results.push(...probeAssertions(value, "startup", value.startupProbe));
    results.push(
      located(
        value,
        "readiness dependency scope",
        value.readinessChecksOptionalDependencies !== true,
        "Readiness does not depend on optional downstreams",
        value.readinessChecksOptionalDependencies,
        "$.spec.template.spec.containers[0].readinessProbe"
      )
    );
    return results;
  }
});

export const kubernetesResourcesGate = createEvidenceGate({
  type: "kubernetes.resources",
  description: "Validate Kubernetes resources, replicas, and disruption protection.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const resources = record(value.resources) ?? {};
    const requests = record(resources.requests);
    const limits = record(resources.limits);
    const cpuRequest = quantity(requests?.cpu);
    const cpuLimit = quantity(limits?.cpu);
    const memoryRequest = quantity(requests?.memory);
    const memoryLimit = quantity(limits?.memory);
    const replicas = typeof value.replicas === "number" ? value.replicas : 0;
    return [
      located(
        value,
        "CPU request",
        cpuRequest !== undefined,
        "CPU request is declared",
        requests?.cpu,
        "$.spec.template.spec.containers[0].resources.requests.cpu"
      ),
      located(
        value,
        "memory request",
        memoryRequest !== undefined,
        "Memory request is declared",
        requests?.memory,
        "$.spec.template.spec.containers[0].resources.requests.memory"
      ),
      located(
        value,
        "memory limit",
        memoryLimit !== undefined,
        "Memory limit is declared",
        limits?.memory,
        "$.spec.template.spec.containers[0].resources.limits.memory"
      ),
      located(
        value,
        "CPU request and limit",
        cpuRequest !== undefined && (cpuLimit === undefined || cpuRequest <= cpuLimit),
        "CPU request does not exceed its limit",
        cpuRequest,
        "$.spec.template.spec.containers[0].resources"
      ),
      located(
        value,
        "memory request and limit",
        memoryRequest !== undefined && memoryLimit !== undefined && memoryRequest <= memoryLimit,
        "Memory request does not exceed its limit",
        memoryRequest,
        "$.spec.template.spec.containers[0].resources"
      ),
      located(
        value,
        "production replicas",
        value.production !== true || replicas >= 2,
        "Production workload has at least two replicas",
        replicas,
        "$.spec.replicas",
        2
      ),
      located(
        value,
        "disruption budget",
        replicas < 2 || record(value.disruptionBudget) !== undefined,
        "Multi-replica workload has a disruption budget",
        value.disruptionBudget,
        "$[PodDisruptionBudget].spec"
      )
    ];
  }
});

export const kubernetesRolloutStrategyGate = createEvidenceGate({
  type: "kubernetes.rollout_strategy",
  description: "Validate an availability-preserving Kubernetes rollout strategy.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const maximumUnavailable =
      typeof value.maxUnavailable === "number" ? value.maxUnavailable : Number.POSITIVE_INFINITY;
    return [
      located(
        value,
        "strategy",
        value.strategy === "RollingUpdate",
        "Workload uses RollingUpdate",
        value.strategy,
        "$.spec.strategy.type",
        "RollingUpdate"
      ),
      located(
        value,
        "maximum unavailable",
        maximumUnavailable <= 1,
        "At most one replica may be unavailable",
        value.maxUnavailable,
        "$.spec.strategy.rollingUpdate.maxUnavailable",
        1
      ),
      located(
        value,
        "progress deadline",
        typeof value.progressDeadlineSeconds === "number" && value.progressDeadlineSeconds > 0,
        "Progress deadline is declared",
        value.progressDeadlineSeconds,
        "$.spec.progressDeadlineSeconds"
      ),
      located(
        value,
        "minimum ready seconds",
        typeof value.minimumReadySeconds === "number" && value.minimumReadySeconds >= 5,
        "Minimum ready duration is at least five seconds",
        value.minimumReadySeconds,
        "$.spec.minReadySeconds",
        5
      )
    ];
  }
});
