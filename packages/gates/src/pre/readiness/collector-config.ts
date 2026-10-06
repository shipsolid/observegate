import { assertion, createEvidenceGate } from "../../evaluation.js";

export const collectorConfigurationGate = createEvidenceGate({
  type: "telemetry.pipeline_configuration",
  description: "Validate collector routing and resilience.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const processors = Array.isArray(value.processors) ? value.processors : [];
    const exporters = Array.isArray(value.exporters) ? value.exporters : [];
    return [
      assertion("receiver", value.receiver === true, "Collector receiver exists"),
      assertion(
        "processors",
        ["memory_limiter", "batch"].every((processor) => processors.includes(processor)),
        "Collector includes memory limiter and batch processors"
      ),
      assertion(
        "signal exporters",
        ["metrics", "logs", "traces"].every((signal) => exporters.includes(signal)),
        "Collector exports every required signal"
      ),
      assertion(
        "resilience",
        value.retry === true && value.sendingQueue === true && value.tls === true,
        "Collector retry, queue, and TLS are enabled"
      )
    ];
  }
});
