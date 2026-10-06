import type { Evidence, EvidenceStore, Phase } from "@observability-gate/core";

export type MissingEvidenceBehavior = "fail" | "warn" | "inconclusive";

export interface GateContext {
  readonly phase: Phase;
  readonly targetId: string;
  readonly releaseId?: string;
  readonly evidenceStore: EvidenceStore;
  readonly signal: AbortSignal;
  readonly clock: () => Date;
  readonly resolveEvidence?: (
    gateType: string,
    definition: Readonly<Record<string, unknown>>,
    context: GateContext
  ) => Promise<readonly Evidence<unknown>[]>;
  readonly missingEvidenceBehavior: {
    readonly blocking: MissingEvidenceBehavior;
    readonly advisory: MissingEvidenceBehavior;
  };
}
