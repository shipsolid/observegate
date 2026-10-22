import { GateError, type AssertionResult } from "@observability-gate/core";
import { createEvidenceGate, parseGateDefinition } from "../../evaluation.js";
import { compareMetricValues, comparisons } from "./metric.js";

const gate = createEvidenceGate({
  type: "comparison.telemetry_volume",
  description: "Compare per-request metric series, log bytes, and spans with a safe baseline.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const items = comparisons(value);
    if (items.length === 0) {
      return [
        {
          assertion: "telemetry volume evidence",
          status: "inconclusive",
          message: "No comparable telemetry volume evidence is available"
        } satisfies AssertionResult
      ];
    }
    return items.flatMap((item) => compareMetricValues({ ...item, normalizedPerRequest: true }));
  }
});

export const comparisonTelemetryVolumeGate = {
  ...gate,
  parseDefinition(input: unknown) {
    const definition = parseGateDefinition(input);
    if (definition.enforcement === "blocking" || definition.allowBlockingBudget !== undefined) {
      throw new GateError({
        code: "CONFIG_SCHEMA",
        safeMessage: "comparison.telemetry_volume supports advisory enforcement only",
        retryable: false
      });
    }
    return definition;
  }
};
