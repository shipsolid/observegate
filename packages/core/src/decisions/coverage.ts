import type { GateResult } from "../domain/gates.js";

export interface EvidenceRequirementCoverage {
  readonly gateId: string;
  readonly requirementId: string;
  readonly satisfied: boolean;
}

export interface CoverageSummary {
  readonly satisfied: number;
  readonly total: number;
  readonly percent: number;
}

export function calculateEvidenceCoverage(
  gates: readonly GateResult[],
  requirements: readonly EvidenceRequirementCoverage[]
): CoverageSummary {
  const applicableGateIds = new Set(
    gates.filter((gate) => gate.status !== "skipped").map((gate) => gate.id)
  );
  const uniqueRequirements = new Map<string, boolean>();
  for (const requirement of requirements) {
    if (!applicableGateIds.has(requirement.gateId)) {
      continue;
    }
    const key = `${requirement.gateId}\u0000${requirement.requirementId}`;
    uniqueRequirements.set(key, requirement.satisfied || uniqueRequirements.get(key) === true);
  }

  const total = uniqueRequirements.size;
  const satisfied = [...uniqueRequirements.values()].filter(Boolean).length;
  const percent = total === 0 ? 100 : Number(((satisfied / total) * 100).toFixed(2));
  return Object.freeze({ satisfied, total, percent });
}
