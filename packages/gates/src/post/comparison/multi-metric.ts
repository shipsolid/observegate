import type { AssertionResult } from "@observability-gate/core";
import { createEvidenceGate } from "../../evaluation.js";
import { compareMetricValues, comparisons } from "./metric.js";

export const comparisonMultiMetricGate = createEvidenceGate({
  type: "comparison.multi_metric",
  description: "Compare candidate CPU and memory demand with per-request baseline values.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const items = comparisons(value);
    if (items.length === 0) {
      return [
        {
          assertion: "comparison metrics",
          status: "inconclusive",
          message: "No comparable resource metrics are available"
        } satisfies AssertionResult
      ];
    }
    return items.flatMap((item) => compareMetricValues({ ...item, normalizedPerRequest: true }));
  }
});
