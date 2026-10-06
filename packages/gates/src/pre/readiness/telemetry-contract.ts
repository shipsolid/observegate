import { assertion, createEvidenceGate } from "../../evaluation.js";

export const otlpContractGate = createEvidenceGate({
  type: "evidence.otlp_contract",
  description: "Validate captured OTLP telemetry contract evidence.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    return [
      assertion(
        "signals",
        [value.metricCount, value.logCount, value.traceCount].every(
          (count) => typeof count === "number" && count > 0
        ),
        "OTLP contract contains metrics, logs, and traces"
      ),
      assertion(
        "correlation",
        typeof value.correlatedLogCount === "number" && value.correlatedLogCount > 0,
        "Logs correlate to captured traces"
      ),
      assertion(
        "span errors",
        typeof value.errorSpanCount === "number" && value.errorSpanCount > 0,
        "Error spans record error status"
      ),
      assertion(
        "normalized routes",
        Array.isArray(value.routes) &&
          value.routes.every((route) => typeof route === "string" && !/\/\d+(?:\/|$)/u.test(route)),
        "HTTP routes are normalized"
      )
    ];
  }
});
