import type { AssertionResult } from "@observability-gate/core";
import { createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";
import { compareMetricValues, type MetricComparisonInput } from "./metric.js";

export const comparisonTraceMetricsGate = createEvidenceGate({
  type: "comparison.trace_metrics",
  description: "Compare expected dependency latency from trace metrics.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const expected = new Set(
      Array.isArray(value.expectedDependencies) ? value.expectedDependencies.map(String) : []
    );
    const dependencies = Array.isArray(value.dependencies)
      ? (value.dependencies as EvidenceRecord[])
      : [];
    const selected = dependencies.filter((dependency) => expected.has(String(dependency.name)));
    if (expected.size === 0 || selected.length !== expected.size) {
      return [
        {
          assertion: "dependency evidence",
          status: "inconclusive",
          message: "Expected dependency trace metrics are incomplete"
        } satisfies AssertionResult
      ];
    }
    return selected.flatMap((dependency) =>
      compareMetricValues(dependency.comparison as MetricComparisonInput)
    );
  }
});
