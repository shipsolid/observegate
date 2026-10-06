import { assertion, createEvidenceGate } from "../evaluation.js";

export const telemetryCorrelationGate = createEvidenceGate({
  type: "telemetry.correlation",
  description: "Measure structured log correlation for sampled error traces.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const sampled = typeof value.sampledCount === "number" ? value.sampledCount : 0;
    const correlated = typeof value.correlatedCount === "number" ? value.correlatedCount : 0;
    const minimum =
      typeof value.minimumCorrelatedPercent === "number" ? value.minimumCorrelatedPercent : 100;
    const percent = sampled > 0 ? (correlated / sampled) * 100 : 0;
    return [
      assertion("sampled traces", sampled > 0, "At least one error trace was sampled", sampled),
      assertion(
        "trace-log correlation",
        percent >= minimum,
        "Sampled traces have matching trace and span IDs in logs",
        percent,
        minimum
      )
    ];
  }
});

export const telemetryServiceGraphGate = createEvidenceGate({
  type: "telemetry.service_graph",
  description: "Verify expected caller and dependency relationships in traces.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const observed = new Set(
      Array.isArray(value.observedDependencies) ? value.observedDependencies.map(String) : []
    );
    const required = Array.isArray(value.requiredDependencies)
      ? value.requiredDependencies.map(String)
      : [];
    const unknown =
      typeof value.unknownPeerPercent === "number"
        ? value.unknownPeerPercent
        : Number.POSITIVE_INFINITY;
    const maximum =
      typeof value.maximumUnknownPeerPercent === "number" ? value.maximumUnknownPeerPercent : 0;
    return [
      assertion(
        "caller relationship",
        value.callerPresent === true,
        "Expected caller relationship is present"
      ),
      assertion(
        "dependency relationships",
        required.every((dependency) => observed.has(dependency)),
        "Required dependency relationships are present"
      ),
      assertion(
        "unknown peers",
        unknown <= maximum,
        "Unknown peer percentage is within policy",
        unknown,
        maximum
      )
    ];
  }
});
