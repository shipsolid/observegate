import { assertion, createEvidenceGate } from "../../evaluation.js";

export function compareThreshold(observed: number, operator: unknown, threshold: number): boolean {
  if (operator === "lt" || operator === "less_than") return observed < threshold;
  if (operator === "lte" || operator === "less_than_or_equal") return observed <= threshold;
  if (operator === "gt" || operator === "greater_than") return observed > threshold;
  if (operator === "gte" || operator === "greater_than_or_equal") return observed >= threshold;
  if (operator === "eq" || operator === "equal") return observed === threshold;
  return false;
}

export const metricThresholdGate = createEvidenceGate({
  type: "metric.threshold",
  description: "Evaluate a bounded metric threshold from valid samples.",
  phases: ["pre_deployment", "post_deployment"],
  providerRequirements: [{ provider: "metrics", capability: "query", required: true }],
  evaluate(_definition, value) {
    const observed = typeof value.value === "number" ? value.value : Number.NaN;
    const threshold = typeof value.threshold === "number" ? value.threshold : Number.NaN;
    const samples = typeof value.sampleCount === "number" ? value.sampleCount : 0;
    const minimum = typeof value.minimumSamples === "number" ? value.minimumSamples : 1;
    const assertions = [
      assertion(
        "minimum samples",
        samples >= minimum,
        "Metric has enough valid samples",
        samples,
        minimum
      ),
      assertion(
        "threshold",
        Number.isFinite(observed) &&
          Number.isFinite(threshold) &&
          compareThreshold(observed, value.operator, threshold),
        "Metric satisfies its threshold",
        observed,
        threshold
      )
    ];
    const minimumRequests =
      typeof value.minimumRequests === "number"
        ? value.minimumRequests
        : typeof value.minimumTotalRequests === "number"
          ? value.minimumTotalRequests
          : undefined;
    if (minimumRequests !== undefined) {
      const requestCount = typeof value.requestCount === "number" ? value.requestCount : 0;
      assertions.unshift(
        assertion(
          "minimum requests",
          requestCount >= minimumRequests,
          "Metric has enough candidate traffic",
          requestCount,
          minimumRequests
        )
      );
    }
    return assertions;
  }
});
