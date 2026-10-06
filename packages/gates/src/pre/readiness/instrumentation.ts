import { assertion, createEvidenceGate } from "../../evaluation.js";

export const instrumentationConfigurationGate = createEvidenceGate({
  type: "artifact.instrumentation_configuration",
  description: "Validate rendered telemetry instrumentation.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    return [
      assertion(
        "canonical resource",
        [value.serviceName, value.serviceVersion, value.environment].every(
          (item) => typeof item === "string" && item.length > 0
        ),
        "Rendered artifact declares canonical resource identity"
      ),
      assertion(
        "OTLP route",
        value.otlpConfigured === true,
        "OTLP endpoint or local agent is configured"
      ),
      assertion(
        "signals",
        value.metrics === true && value.logs === true && value.traces === true,
        "Metrics, logs, and traces are enabled"
      ),
      assertion(
        "production exporter",
        value.debugExporter !== true && value.plaintextRemote !== true,
        "Production export uses TLS without a debug exporter"
      ),
      assertion(
        "credentials",
        value.hardcodedCredentials !== true,
        "Rendered artifact contains no hardcoded credentials"
      )
    ];
  }
});

export const sarifEvidenceGate = createEvidenceGate({
  type: "evidence.sarif",
  description: "Evaluate static instrumentation findings.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const findings = Array.isArray(value.findings) ? value.findings : [];
    const errors = findings.filter((finding) => (finding as { level?: unknown }).level === "error");
    return [
      assertion(
        "SARIF errors",
        errors.length === 0,
        "Static instrumentation analysis has no error findings",
        errors.length,
        0
      )
    ];
  }
});
