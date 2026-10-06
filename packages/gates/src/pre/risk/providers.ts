import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const providersHealthGate = createEvidenceGate({
  type: "providers.health",
  description:
    "Validate required provider reachability, latency, authentication, and query access.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const providers = Array.isArray(value.providers) ? (value.providers as EvidenceRecord[]) : [];
    return [
      assertion(
        "required providers",
        providers.length > 0 && providers.every((provider) => provider.reachable === true),
        "Every required provider is reachable"
      ),
      assertion(
        "provider authentication",
        providers.every(
          (provider) => provider.authenticated === true && provider.authorized === true
        ),
        "Every required provider accepts read credentials"
      ),
      assertion(
        "provider latency",
        providers.every(
          (provider) =>
            typeof provider.latencyMs === "number" &&
            provider.latencyMs <=
              (typeof provider.maximumLatencyMs === "number" ? provider.maximumLatencyMs : 5_000)
        ),
        "Provider latency is within policy"
      )
    ];
  }
});
