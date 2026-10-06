export interface BaselineCandidate {
  readonly releaseId: string;
  readonly deployedAt: string;
  readonly healthy: boolean;
  readonly trusted: boolean;
  readonly samples: number;
  readonly duringIncident?: boolean;
  readonly duringDeployment?: boolean;
}

export type BaselineSelection =
  | { readonly status: "selected"; readonly baseline: BaselineCandidate }
  | { readonly status: "insufficient"; readonly reason: string };

export function selectBaseline(input: {
  readonly candidates: readonly BaselineCandidate[];
  readonly explicitReleaseId?: string;
  readonly candidateReleaseId: string;
  readonly lookbackStart: string;
  readonly minimumSamples: number;
}): BaselineSelection {
  const lookbackStart = Date.parse(input.lookbackStart);
  const safe = input.candidates.filter((candidate) => {
    const deployedAt = Date.parse(candidate.deployedAt);
    return (
      candidate.releaseId !== input.candidateReleaseId &&
      candidate.healthy &&
      candidate.trusted &&
      candidate.samples >= input.minimumSamples &&
      !candidate.duringIncident &&
      !candidate.duringDeployment &&
      Number.isFinite(deployedAt) &&
      Number.isFinite(lookbackStart) &&
      deployedAt >= lookbackStart
    );
  });
  const selected =
    input.explicitReleaseId === undefined
      ? [...safe].sort(
          (left, right) => Date.parse(right.deployedAt) - Date.parse(left.deployedAt)
        )[0]
      : safe.find((candidate) => candidate.releaseId === input.explicitReleaseId);
  return selected === undefined
    ? { status: "insufficient", reason: "No safe baseline release is available" }
    : { status: "selected", baseline: selected };
}
