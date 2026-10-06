import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

function policyAssertions(_definition: EvidenceRecord, value: EvidenceRecord) {
  const sections = Array.isArray(value.sections) ? value.sections : [];
  const required = [
    "identity",
    "targets",
    "providers",
    "gates.pre_deployment",
    "gates.post_deployment",
    "reporting",
    "security"
  ];
  return [
    assertion(
      "required sections",
      required.every((section) => sections.includes(section)),
      "Policy declares every required section",
      sections,
      required
    ),
    assertion("unique gate IDs", value.uniqueGateIds === true, "Gate identifiers are unique"),
    assertion(
      "known fields",
      value.unknownFields === 0,
      "Policy has no unknown fields",
      value.unknownFields,
      0
    ),
    assertion(
      "secret references",
      value.inlineSecrets === 0,
      "Policy contains no inline secrets",
      value.inlineSecrets,
      0
    ),
    assertion(
      "blocking post gates",
      typeof value.blockingPostGates === "number" && value.blockingPostGates > 0,
      "Policy has a blocking post-deployment gate",
      value.blockingPostGates
    )
  ];
}

export const policySelfCheckGate = createEvidenceGate({
  type: "policy.self_check",
  description: "Validate policy completeness and secret-safe references.",
  phases: ["pre_deployment"],
  evaluate: policyAssertions
});
