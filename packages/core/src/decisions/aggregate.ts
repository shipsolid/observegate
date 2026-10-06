import type { Decision, GateResult, GateStatus } from "../domain/gates.js";
import {
  calculateEvidenceCoverage,
  type CoverageSummary,
  type EvidenceRequirementCoverage
} from "./coverage.js";

export interface DecisionPolicy {
  readonly minimumEvidenceCoveragePercent: number;
  readonly warnOnSkipped: boolean;
}

export interface DecisionReason {
  readonly gateId: string;
  readonly status: "failed" | "inconclusive" | "error";
  readonly message: string;
}

export interface DecisionCounts {
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly inconclusive: number;
  readonly error: number;
  readonly skipped: number;
}

export interface AggregateDecisionInput {
  readonly gates: readonly GateResult[];
  readonly configurationOrder?: readonly string[];
  readonly policy: DecisionPolicy;
  readonly evidenceRequirements: readonly EvidenceRequirementCoverage[];
}

export interface DecisionSummary {
  readonly decision: Decision;
  readonly counts: DecisionCounts;
  readonly evidenceCoveragePercent: number;
  readonly coverage: CoverageSummary;
  readonly blockingReasons: readonly DecisionReason[];
  readonly gates: readonly GateResult[];
}

function orderGates(
  gates: readonly GateResult[],
  configurationOrder: readonly string[] | undefined
): readonly GateResult[] {
  if (configurationOrder === undefined) {
    return Object.freeze([...gates]);
  }
  const order = new Map(configurationOrder.map((id, index) => [id, index]));
  return Object.freeze(
    gates
      .map((gate, completionIndex) => ({ gate, completionIndex }))
      .sort((left, right) => {
        const leftIndex = order.get(left.gate.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = order.get(right.gate.id) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex || left.completionIndex - right.completionIndex;
      })
      .map(({ gate }) => gate)
  );
}

function countStatuses(gates: readonly GateResult[]): DecisionCounts {
  const counts: Record<GateStatus, number> = {
    passed: 0,
    warned: 0,
    failed: 0,
    inconclusive: 0,
    error: 0,
    skipped: 0
  };
  for (const gate of gates) {
    counts[gate.status] += 1;
  }
  return Object.freeze(counts);
}

function reasonMessage(gate: GateResult): string {
  return (
    gate.diagnostics[0]?.message ??
    gate.assertions.find((assertion) => assertion.status !== "passed")?.message ??
    `Blocking gate ${gate.id} ended with status ${gate.status}.`
  );
}

export function aggregateDecision(input: AggregateDecisionInput): DecisionSummary {
  const gates = orderGates(input.gates, input.configurationOrder);
  const coverage = calculateEvidenceCoverage(gates, input.evidenceRequirements);
  const blocking = gates.filter((gate) => gate.enforcement === "blocking");
  const coverageFailed = coverage.percent < input.policy.minimumEvidenceCoveragePercent;

  let decision: Decision;
  if (blocking.some((gate) => gate.status === "error")) {
    decision = "error";
  } else if (blocking.some((gate) => gate.status === "failed") || coverageFailed) {
    decision = "fail";
  } else if (blocking.some((gate) => gate.status === "inconclusive")) {
    decision = "inconclusive";
  } else if (
    gates.some(
      (gate) =>
        gate.enforcement === "advisory" && gate.status !== "passed" && gate.status !== "skipped"
    ) ||
    (input.policy.warnOnSkipped && gates.some((gate) => gate.status === "skipped"))
  ) {
    decision = "warn";
  } else {
    decision = "pass";
  }

  const blockingReasons: DecisionReason[] = [];
  if (coverageFailed) {
    blockingReasons.push(
      Object.freeze({
        gateId: "evidence-coverage",
        status: "failed",
        message: `Evidence coverage ${coverage.percent}% is below the required ${input.policy.minimumEvidenceCoveragePercent}%.`
      })
    );
  }
  for (const gate of blocking) {
    if (gate.status === "failed" || gate.status === "inconclusive" || gate.status === "error") {
      blockingReasons.push(
        Object.freeze({
          gateId: gate.id,
          status: gate.status,
          message: reasonMessage(gate)
        })
      );
    }
  }

  return Object.freeze({
    decision,
    counts: countStatuses(gates),
    evidenceCoveragePercent: coverage.percent,
    coverage,
    blockingReasons: Object.freeze(blockingReasons),
    gates
  });
}
