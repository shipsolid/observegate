import { GateError } from "@observability-gate/core";
import { assertion, createEvidenceGate, parseGateDefinition } from "../../evaluation.js";

function budgetGate(type: "telemetry.cardinality_estimate" | "telemetry.volume_estimate") {
  const gate = createEvidenceGate({
    type,
    description: "Evaluate a pre-deployment telemetry FinOps estimate.",
    phases: ["pre_deployment"],
    evaluate(_definition, value) {
      const estimate =
        typeof value.estimate === "number" ? value.estimate : Number.POSITIVE_INFINITY;
      const budget = typeof value.budget === "number" ? value.budget : 0;
      return [
        assertion(
          "telemetry budget",
          estimate <= budget,
          "Telemetry estimate remains within budget",
          estimate,
          budget
        )
      ];
    }
  });
  return {
    ...gate,
    parseDefinition(input: unknown) {
      const definition = parseGateDefinition(input);
      if (definition.enforcement === "blocking" && definition.allowBlockingBudget !== true) {
        throw new GateError({
          code: "CONFIG_SCHEMA",
          safeMessage: `${type} is advisory unless blocking enforcement is explicitly allowed`,
          retryable: false
        });
      }
      return definition;
    }
  };
}

export const cardinalityEstimateGate = budgetGate("telemetry.cardinality_estimate");
export const telemetryVolumeEstimateGate = budgetGate("telemetry.volume_estimate");
