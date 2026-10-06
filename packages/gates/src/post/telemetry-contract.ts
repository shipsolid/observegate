import { assertion, createEvidenceGate } from "../evaluation.js";

export const telemetryContractGate = createEvidenceGate({
  type: "telemetry.contract",
  description: "Validate the live metric, log, trace, resource, and sensitive-field contract.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const signals = new Set(Array.isArray(value.signals) ? value.signals.map(String) : []);
    const required = Array.isArray(value.requiredSignals) ? value.requiredSignals.map(String) : [];
    const forbidden = Array.isArray(value.forbiddenFieldsFound)
      ? value.forbiddenFieldsFound
      : ["invalid"];
    return [
      assertion(
        "required signals",
        required.length > 0 && required.every((signal) => signals.has(signal)),
        "All required telemetry signals are live"
      ),
      assertion(
        "resource attributes",
        value.resourceAttributesValid === true,
        "Required resource attributes have expected values"
      ),
      assertion(
        "HTTP server metric",
        value.httpServerDurationMetricPresent === true,
        "HTTP server duration metric is present"
      ),
      assertion(
        "error logs",
        value.errorLogsPresent === true,
        "Failed requests produce error logs"
      ),
      assertion("server spans", value.serverSpansPresent === true, "Server spans are present"),
      assertion(
        "sensitive fields",
        forbidden.length === 0,
        "Forbidden sensitive fields are absent",
        forbidden.length,
        0
      )
    ];
  }
});
