import { assertion, createEvidenceGate } from "../../evaluation.js";

function comparison(observed: number, operator: unknown, threshold: number): boolean {
  if (operator === "lt") return observed < threshold;
  if (operator === "lte") return observed <= threshold;
  if (operator === "gt") return observed > threshold;
  if (operator === "gte") return observed >= threshold;
  if (operator === "eq") return observed === threshold;
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
    return [
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
          comparison(observed, value.operator, threshold),
        "Metric satisfies its threshold",
        observed,
        threshold
      )
    ];
  }
});
