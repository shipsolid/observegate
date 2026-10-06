import { assertion, createEvidenceGate, type EvidenceRecord } from "../evaluation.js";
import { compareThreshold } from "../pre/risk/metrics.js";

export const metricMultiThresholdGate = createEvidenceGate({
  type: "metric.multi_threshold",
  description: "Evaluate multiple candidate resource metrics atomically.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const metrics = Array.isArray(value.metrics) ? (value.metrics as EvidenceRecord[]) : [];
    if (metrics.length === 0) {
      return [
        assertion("required metrics", false, "Saturation evidence contains candidate metrics", 0)
      ];
    }
    const results = metrics.map((metric) => {
      const observed = typeof metric.value === "number" ? metric.value : Number.NaN;
      const threshold = typeof metric.threshold === "number" ? metric.threshold : Number.NaN;
      return assertion(
        String(metric.name ?? "metric"),
        Number.isFinite(observed) &&
          Number.isFinite(threshold) &&
          compareThreshold(observed, metric.operator, threshold),
        "Candidate metric satisfies its threshold",
        observed,
        threshold
      );
    });
    if (typeof value.minimumRequests === "number") {
      const requests = typeof value.requestCount === "number" ? value.requestCount : 0;
      results.unshift(
        assertion(
          "minimum requests",
          requests >= value.minimumRequests,
          "Candidate has enough request samples",
          requests,
          value.minimumRequests
        )
      );
    }
    return results;
  }
});

export const runtimeStabilityGate = createEvidenceGate({
  type: "runtime.stability",
  description: "Reject restarts, crash loops, out-of-memory terminations, and unhealthy instances.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    return [
      ["unexpected restarts", value.unexpectedRestarts],
      ["crash loops", value.crashLoops],
      ["out-of-memory terminations", value.outOfMemoryTerminations],
      ["unhealthy instances", value.unhealthyInstances]
    ].map(([name, observed]) =>
      assertion(String(name), observed === 0, `Runtime has no ${String(name)}`, observed, 0)
    );
  }
});
