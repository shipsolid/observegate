import { assertion, createEvidenceGate, type EvidenceRecord } from "../evaluation.js";
import { sanitizeIdentity } from "./workload.js";

export const telemetryIdentityGate = createEvidenceGate({
  type: "telemetry.identity_consistency",
  description: "Compare canonical identity across runtime, telemetry signals, and attestation.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const identities = Array.isArray(value.identities)
      ? (value.identities as EvidenceRecord[])
      : [];
    const expected = sanitizeIdentity(value.expectedReleaseId);
    const observed = identities.map((identity) => ({
      source: sanitizeIdentity(identity.source),
      releaseId: sanitizeIdentity(identity.releaseId)
    }));
    const releaseIds = observed.map((identity) => identity.releaseId);
    return [
      assertion(
        "identity sources",
        identities.length > 0 && identities.every((identity) => identity.consistent === true),
        "Canonical identity fields agree across every source",
        observed
      ),
      assertion(
        "release identity",
        releaseIds.length > 0 &&
          releaseIds.every((releaseId) => releaseId === expected) &&
          new Set(releaseIds).size === 1,
        "Release ID agrees across every source",
        observed,
        expected
      )
    ];
  }
});
