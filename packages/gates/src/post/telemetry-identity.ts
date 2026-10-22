import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../evaluation.js";
import { sanitizeIdentity } from "./workload.js";

export const telemetryIdentityGate = createEvidenceGate({
  type: "telemetry.identity_consistency",
  description: "Compare canonical identity across runtime, telemetry signals, and attestation.",
  phases: ["post_deployment"],
  evaluate(definition, value) {
    const identities = Array.isArray(value.identities)
      ? (value.identities as EvidenceRecord[])
      : [];
    const expected = value.expectedReleaseId;
    const observed = identities.map((identity) => ({
      source: sanitizeIdentity(identity.source),
      releaseId: sanitizeIdentity(identity.releaseId)
    }));
    const releaseIds = identities.map((identity) => identity.releaseId);
    const sources = identities.map((identity) => identity.source);
    const configuredSources = Object.keys(record(definition.sources) ?? {}).map((source) =>
      source === "deployment_evidence" ? "attestation" : source
    );
    const requiredSources =
      configuredSources.length > 0
        ? configuredSources
        : Array.isArray(value.requiredSources) && value.requiredSources.length > 0
          ? value.requiredSources
          : ["runtime", "metrics", "logs", "traces", "attestation"];
    return [
      assertion(
        "identity sources",
        identities.length > 0 &&
          identities.every(
            (identity) =>
              identity.consistent === true &&
              typeof identity.source === "string" &&
              identity.source.length > 0
          ) &&
          requiredSources.every((source) => sources.includes(source)),
        "Canonical identity fields agree across every source",
        observed
      ),
      assertion(
        "release identity",
        typeof expected === "string" &&
          expected.length > 0 &&
          releaseIds.length > 0 &&
          releaseIds.every((releaseId) => releaseId === expected) &&
          new Set(releaseIds).size === 1,
        "Release ID agrees across every source",
        observed,
        sanitizeIdentity(expected)
      )
    ];
  }
});
