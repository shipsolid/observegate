import type { EvidenceStore, Phase } from "@observability-gate/core";

export type MissingEvidenceBehavior = "fail" | "warn" | "inconclusive";

export interface GateContext {
  readonly phase: Phase;
  readonly targetId: string;
  readonly releaseId?: string;
  readonly evidenceStore: EvidenceStore;
  readonly signal: AbortSignal;
  readonly clock: () => Date;
  readonly missingEvidenceBehavior: {
    readonly blocking: MissingEvidenceBehavior;
    readonly advisory: MissingEvidenceBehavior;
  };
}
