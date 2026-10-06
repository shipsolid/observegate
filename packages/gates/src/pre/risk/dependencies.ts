import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const dependencyHealthGate = createEvidenceGate({
  type: "dependency.health",
  description: "Require every configured dependency to be healthy.",
  phases: ["pre_deployment", "post_deployment"],
  evaluate(_definition, value) {
    const dependencies = Array.isArray(value.dependencies)
      ? (value.dependencies as EvidenceRecord[])
      : [];
    const unhealthy = dependencies.filter(
      (dependency) => dependency.required !== false && dependency.healthy !== true
    );
    return [
      assertion(
        "required dependencies",
        dependencies.length > 0 && unhealthy.length === 0,
        "Every required dependency is healthy",
        unhealthy.length,
        0
      )
    ];
  }
});
