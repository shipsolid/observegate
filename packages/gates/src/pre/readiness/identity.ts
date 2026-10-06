import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const identityContractGate = createEvidenceGate({
  type: "identity.contract",
  description: "Validate canonical service and immutable release identity.",
  phases: ["pre_deployment"],
  evaluate(definition, value) {
    const assertions = (definition.assertions as EvidenceRecord | undefined) ?? {};
    const releaseRules = (assertions.release_id as EvidenceRecord | undefined) ?? {};
    const forbidden = Array.isArray(releaseRules.forbidden_values)
      ? releaseRules.forbidden_values
      : ["latest", "main", "master", "unknown", "unset"];
    const releaseId = typeof value.releaseId === "string" ? value.releaseId : "";
    const environment = typeof value.environment === "string" ? value.environment : "";
    const minimum =
      typeof releaseRules.minimum_length === "number" ? releaseRules.minimum_length : 7;
    const maximum =
      typeof releaseRules.maximum_length === "number" ? releaseRules.maximum_length : 128;
    return [
      assertion(
        "required identity",
        [value.serviceName, value.serviceNamespace, value.environment, value.releaseId].every(
          (item) => typeof item === "string" && item.length > 0
        ),
        "Canonical identity values are present"
      ),
      assertion(
        "immutable release",
        releaseId.length >= minimum &&
          releaseId.length <= maximum &&
          !forbidden.includes(releaseId.toLowerCase()),
        "Release identity is immutable and bounded",
        releaseId
      ),
      assertion(
        "environment syntax",
        /^[a-z0-9][a-z0-9._-]*$/u.test(environment),
        "Environment matches the canonical pattern",
        environment
      )
    ];
  }
});
