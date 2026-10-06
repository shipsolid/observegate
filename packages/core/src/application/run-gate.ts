import type { EvidenceStore } from "../evidence/store.js";
import type { GateResult } from "../domain/gates.js";
import type { PlannedGate } from "../domain/planning.js";

export interface GateRunContext {
  readonly signal: AbortSignal;
  readonly evidenceStore: EvidenceStore;
}

export type GateExecutor = (gate: PlannedGate, context: GateRunContext) => Promise<GateResult>;

export async function runGate(
  gate: PlannedGate,
  context: GateRunContext,
  execute: GateExecutor
): Promise<GateResult> {
  return execute(gate, context);
}
