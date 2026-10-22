import { GateError, type AssertionResult } from "@observability-gate/core";
import { assertion, createEvidenceGate, parseGateDefinition, record } from "../../evaluation.js";

function budgetGate(type: "telemetry.cardinality_estimate" | "telemetry.volume_estimate") {
  const gate = createEvidenceGate({
    type,
    description: "Evaluate a pre-deployment telemetry FinOps estimate.",
    phases: ["pre_deployment"],
    providerRequirements: [
      { provider: "metrics", capability: "metrics.query.instant", required: true }
    ],
    evaluate(definition, value) {
      const assertions = record(definition.assertions) ?? {};
      const limits =
        type === "telemetry.volume_estimate"
          ? (record(assertions.estimated_growth_percent) ?? {})
          : assertions;
      const measurements = record(value.measurements) ?? {};
      if (Object.keys(limits).length === 0)
        return [
          {
            assertion: "telemetry budget",
            status: "inconclusive",
            message: "No per-dimension budget assertions are configured"
          } satisfies AssertionResult
        ];
      return Object.entries(limits).map(([name, comparison]): AssertionResult => {
        const observed = measurements[name];
        const expected = record(comparison)?.less_than_or_equal;
        const unit =
          type === "telemetry.volume_estimate" || name.endsWith("_percent") ? "percent" : "count";
        if (
          typeof observed !== "number" ||
          !Number.isFinite(observed) ||
          typeof expected !== "number" ||
          !Number.isFinite(expected)
        )
          return {
            assertion: `${name} budget (${unit})`,
            status: "inconclusive",
            message: `Missing measured evidence or limit for ${name}`
          };
        return assertion(
          `${name} budget (${unit})`,
          observed <= expected,
          `${name} measured ${unit} remains within its configured budget`,
          observed,
          expected
        );
      });
    }
  });
  return {
    ...gate,
    parseDefinition(input: unknown) {
      const definition = parseGateDefinition(input);
      if (definition.enforcement === "blocking" || definition.allowBlockingBudget !== undefined) {
        throw new GateError({
          code: "CONFIG_SCHEMA",
          safeMessage: `${type} supports advisory enforcement only`,
          retryable: false
        });
      }
      return definition;
    }
  };
}

export const cardinalityEstimateGate = budgetGate("telemetry.cardinality_estimate");
export const telemetryVolumeEstimateGate = budgetGate("telemetry.volume_estimate");
