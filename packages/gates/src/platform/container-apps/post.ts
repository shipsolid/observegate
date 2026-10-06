import { assertion, createEvidenceGate, record } from "../../evaluation.js";

export const containerAppsRevisionStatusGate = createEvidenceGate({
  type: "azure_container_apps.revision_status",
  description: "Validate Container Apps application, revision, and replica readiness.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const revision = record(value.revision) ?? {};
    const replicas = record(value.replicas) ?? {};
    const healthy = typeof replicas.healthy === "number" ? replicas.healthy : 0;
    const minimum = typeof replicas.minimumHealthy === "number" ? replicas.minimumHealthy : 1;
    return [
      assertion(
        "application provisioning",
        value.provisioningState === "Succeeded",
        "Container App provisioning succeeded",
        value.provisioningState,
        "Succeeded"
      ),
      assertion(
        "revision provisioning",
        revision.provisioningState === "Provisioned",
        "Candidate revision is provisioned",
        revision.provisioningState,
        "Provisioned"
      ),
      assertion(
        "revision running",
        revision.runningState === "Running",
        "Candidate revision is running",
        revision.runningState,
        "Running"
      ),
      assertion("revision active", revision.active === true, "Candidate revision is active"),
      assertion(
        "healthy replicas",
        healthy >= minimum,
        "Enough candidate replicas are healthy",
        healthy,
        minimum
      ),
      assertion(
        "failed replicas",
        replicas.failed === 0,
        "No candidate replicas failed",
        replicas.failed,
        0
      )
    ];
  }
});

export const containerAppsImageIdentityGate = createEvidenceGate({
  type: "azure_container_apps.image_identity",
  description: "Compare Container Apps image digest and revision suffix with release expectations.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const revision = record(value.revision) ?? {};
    return [
      assertion(
        "image digest",
        typeof revision.expectedImageDigest === "string" &&
          revision.imageDigest === revision.expectedImageDigest,
        "Candidate image digest matches the expected release",
        revision.imageDigest,
        revision.expectedImageDigest
      ),
      assertion(
        "revision suffix",
        typeof revision.expectedSuffix === "string" && revision.suffix === revision.expectedSuffix,
        "Candidate revision suffix matches the expected release",
        revision.suffix,
        revision.expectedSuffix
      )
    ];
  }
});

export const containerAppsTrafficGate = createEvidenceGate({
  type: "azure_container_apps.traffic",
  description: "Observe workflow-owned Container Apps traffic weights without mutating them.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const traffic = record(value.traffic) ?? {};
    const candidate = typeof traffic.candidateWeight === "number" ? traffic.candidateWeight : 0;
    const minimum =
      typeof traffic.minimumCandidateWeight === "number" ? traffic.minimumCandidateWeight : 1;
    const unknown =
      typeof traffic.unknownRevisionWeight === "number"
        ? traffic.unknownRevisionWeight
        : Number.POSITIVE_INFINITY;
    const maximumUnknown =
      typeof traffic.maximumUnknownRevisionWeight === "number"
        ? traffic.maximumUnknownRevisionWeight
        : 0;
    return [
      assertion(
        "candidate traffic",
        candidate >= minimum,
        "Observed workflow-owned candidate traffic meets policy",
        candidate,
        minimum
      ),
      assertion(
        "unknown revision traffic",
        unknown <= maximumUnknown,
        "Observed traffic to unknown revisions is within policy",
        unknown,
        maximumUnknown
      ),
      assertion(
        "traffic total",
        traffic.totalWeight === 100,
        "Observed workflow-owned traffic weights sum to 100",
        traffic.totalWeight,
        100
      )
    ];
  }
});

export const containerAppsReplicaHealthGate = createEvidenceGate({
  type: "azure_container_apps.replica_health",
  description: "Validate Container Apps replica stability and lifecycle failures.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const replicas = record(value.replicas) ?? {};
    return [
      assertion(
        "restart increase",
        replicas.restartIncrease === 0,
        "Replica restarts did not increase",
        replicas.restartIncrease,
        0
      ),
      assertion(
        "unhealthy replicas",
        replicas.unhealthy === 0,
        "No candidate replicas are unhealthy",
        replicas.unhealthy,
        0
      ),
      assertion(
        "activation failures",
        replicas.activationFailures === 0,
        "No replica activation failed",
        replicas.activationFailures,
        0
      ),
      assertion(
        "deactivation failures",
        replicas.deactivationFailures === 0,
        "No replica deactivation failed",
        replicas.deactivationFailures,
        0
      )
    ];
  }
});
