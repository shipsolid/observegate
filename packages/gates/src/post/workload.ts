import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../evaluation.js";

export function sanitizeIdentity(value: unknown): string {
  return String(value ?? "missing")
    .slice(0, 128)
    .replace(/[^A-Za-z0-9._:@/+%-]/g, "?");
}

function identityValues(value: EvidenceRecord, key: string): string[] {
  return [
    record(value.runtime)?.[key],
    record(value.attestation)?.[key],
    record(value.expected)?.[key]
  ]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map(sanitizeIdentity);
}

function identityAssertion(value: EvidenceRecord, key: string, label: string) {
  const values = identityValues(value, key);
  return assertion(
    label,
    values.length >= 2 && new Set(values).size === 1,
    `${label} agrees across runtime, attestation, and expected release`,
    values
  );
}

export const runtimeProvisionedGate = createEvidenceGate({
  type: "runtime.provisioned",
  description: "Verify that the intended runtime resource was provisioned after deployment.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const observedAt = Date.parse(String(value.observedAt));
    const deployedAt = Date.parse(String(value.deployedAt));
    return [
      assertion("resource exists", value.resourceExists === true, "Runtime resource exists"),
      assertion(
        "provisioning state",
        ["succeeded", "ready", "available"].includes(String(value.provisioningState).toLowerCase()),
        "Runtime provisioning state is healthy",
        value.provisioningState
      ),
      assertion(
        "observed after deployment",
        Number.isFinite(observedAt) && Number.isFinite(deployedAt) && observedAt >= deployedAt,
        "Runtime state was observed after deployment",
        value.observedAt,
        value.deployedAt
      )
    ];
  }
});

export const runtimeReadyGate = createEvidenceGate({
  type: "runtime.ready",
  description: "Verify normalized workload readiness over consecutive samples.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const available = typeof value.availableInstances === "number" ? value.availableInstances : 0;
    const minimum =
      typeof value.minimumAvailableInstances === "number" ? value.minimumAvailableInstances : 1;
    const consecutive =
      typeof value.consecutiveSuccessfulSamples === "number"
        ? value.consecutiveSuccessfulSamples
        : 0;
    const required =
      typeof value.requiredConsecutiveSamples === "number" ? value.requiredConsecutiveSamples : 3;
    return [
      assertion("ready", value.ready === true, "Runtime reports the workload ready"),
      assertion(
        "available instances",
        available >= minimum,
        "Enough instances are available",
        available,
        minimum
      ),
      assertion(
        "unavailable instances",
        value.unavailableInstances === 0,
        "No instances are unavailable",
        value.unavailableInstances,
        0
      ),
      assertion(
        "consecutive readiness",
        consecutive >= required,
        "Readiness is stable across consecutive samples",
        consecutive,
        required
      )
    ];
  }
});

export const runtimeReleaseIdentityGate = createEvidenceGate({
  type: "runtime.release_identity",
  description: "Compare runtime release identity with signed deployment evidence and expectations.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const results = [identityAssertion(value, "releaseId", "release ID")];
    for (const [key, label] of [
      ["imageDigest", "image digest"],
      ["artifactDigest", "artifact digest"],
      ["deploymentId", "deployment ID"]
    ] as const) {
      if (identityValues(value, key).length > 0) results.push(identityAssertion(value, key, label));
    }
    return results;
  }
});
