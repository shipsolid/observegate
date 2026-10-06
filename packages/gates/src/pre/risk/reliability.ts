import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

const grafana = [{ provider: "grafana", capability: "read", required: true }] as const;

function fresh(value: EvidenceRecord) {
  return assertion(
    "evidence freshness",
    value.fresh === true,
    "Grafana evidence is within the configured maximum age",
    value.fresh,
    true
  );
}

export const sloStatusGate = createEvidenceGate({
  type: "grafana.slo_status",
  description: "Require a fresh met SLO evaluation.",
  phases: ["pre_deployment", "post_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    return [
      fresh(value),
      assertion(
        "SLO status",
        value.status === "met",
        "SLO objective is currently met",
        value.status,
        "met"
      )
    ];
  }
});

export const errorBudgetGate = createEvidenceGate({
  type: "grafana.error_budget",
  description: "Require sufficient remaining error budget.",
  phases: ["pre_deployment", "post_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    const remaining =
      typeof value.remainingPercent === "number" ? value.remainingPercent : Number.NaN;
    const minimum =
      typeof value.minimumRemainingPercent === "number" ? value.minimumRemainingPercent : 0;
    return [
      fresh(value),
      assertion(
        "remaining budget",
        remaining >= minimum,
        "Remaining error budget meets policy",
        remaining,
        minimum
      )
    ];
  }
});

export const burnRateGate = createEvidenceGate({
  type: "grafana.burn_rate",
  description: "Evaluate paired short and long burn windows atomically.",
  phases: ["pre_deployment", "post_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    const pairs = Array.isArray(value.pairs) ? (value.pairs as EvidenceRecord[]) : [];
    return [
      fresh(value),
      assertion(
        "paired burn windows",
        pairs.length > 0 &&
          pairs.every(
            (pair) =>
              typeof pair.shortValue === "number" &&
              typeof pair.longValue === "number" &&
              typeof pair.maximum === "number" &&
              pair.shortValue <= pair.maximum &&
              pair.longValue <= pair.maximum
          ),
        "Every paired burn-rate window is within policy"
      )
    ];
  }
});
