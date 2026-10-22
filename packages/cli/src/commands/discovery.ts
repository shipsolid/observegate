import type { GateTypeMetadata } from "@observability-gate/core";
import { gateContracts } from "@observability-gate/config";

export function discoveryMetadata(metadata: GateTypeMetadata) {
  return {
    ...metadata,
    definitionContract: gateContracts[metadata.type] ?? {},
    resultSemantics: {
      blocking: "A failed assertion, invalid evidence, execution error or inconclusive result blocks deployment.",
      advisory: "Non-passing advisory results contribute a warning.",
      missingEvidence: "The configured no_data policy applies; missing evidence does not prove health."
    }
  };
}

export function discoveryText(metadata: GateTypeMetadata): string {
  const contract = gateContracts[metadata.type] ?? {};
  return `${metadata.description}\nPhases: ${metadata.supportedPhases.join(", ")}\nEvidence: ${metadata.providerRequirements.map((item) => `${item.provider}:${item.capability}`).join(", ") || "Policy-selected sources; see source contract"}\nSource: ${JSON.stringify(contract.source ?? contract.sources ?? {})}\nAssertions: ${JSON.stringify(contract.assertions ?? {})}\nConditions: ${metadata.conditionKeys.join(", ")}\nResults: Blocking non-pass prevents deployment; advisory failures warn.\nRemediation: ${metadata.supportsRemediation ? "Supported via the remediation field." : "Not supported."}\n`;
}
