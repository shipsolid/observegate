export const evidenceStates = [
  "valid",
  "missing",
  "stale",
  "insufficient",
  "invalid",
  "unavailable",
  "unsupported"
] as const;

export type EvidenceState = (typeof evidenceStates)[number];

export function isUsableEvidence(state: EvidenceState): boolean {
  return state === "valid";
}
