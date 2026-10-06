import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const dependencyHealthGate = createEvidenceGate({
  type: "dependency.health",
  description: "Require every configured dependency to be healthy.",
  phases: ["pre_deployment", "post_deployment"],
  evaluate(_definition, value) {
    const dependencies = Array.isArray(value.dependencies)
      ? (value.dependencies as EvidenceRecord[])
      : [];
    if (dependencies.length === 0) {
      return [
        assertion("required dependencies", false, "Dependency health evidence is present", 0)
      ];
    }
    return dependencies
      .filter((dependency) => dependency.required !== false)
      .map((dependency) =>
        assertion(
          String(dependency.name ?? "dependency"),
          dependency.healthy === true,
          "Required dependency is healthy",
          dependency.healthy,
          true
        )
      );
  }
});
