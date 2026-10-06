import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const requiredPostCategories = [
  "workload_identity",
  "workload_readiness",
  "telemetry_presence",
  "telemetry_freshness",
  "error_rate",
  "latency",
  "availability",
  "regression",
  "slo_or_error_budget",
  "active_alerts"
] as const;

export const policyCoverageGate = createEvidenceGate({
  type: "policy.coverage",
  description: "Validate post-deployment failure-mode coverage.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const categories = new Set(Array.isArray(value.categories) ? value.categories.map(String) : []);
    const missing = requiredPostCategories.filter((category) => !categories.has(category));
    return [
      assertion(
        "blocking categories",
        missing.length === 0,
        missing.length === 0
          ? "All required post-deployment categories are covered"
          : `Missing post-deployment categories: ${missing.join(", ")}`,
        missing
      ),
      assertion(
        "platform readiness",
        value.platformSpecific === true,
        "Platform-specific post-deployment readiness is covered"
      )
    ];
  }
});

export function coverageEvidence(
  categories: readonly string[],
  platformSpecific: boolean
): EvidenceRecord {
  return { categories, platformSpecific };
}
