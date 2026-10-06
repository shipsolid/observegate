import type { EvidenceState } from "./states.js";

export interface FreshnessInput {
  readonly observedAt: string;
  readonly acquiredAt: string;
  readonly maximumAgeMs: number;
  readonly maximumFutureSkewMs: number;
  readonly sampleCount: number;
  readonly minimumSamples: number;
}

export function classifyFreshness(input: FreshnessInput): EvidenceState {
  const observedAtMs = Date.parse(input.observedAt);
  const acquiredAtMs = Date.parse(input.acquiredAt);
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(acquiredAtMs)) {
    return "invalid";
  }
  if (observedAtMs - acquiredAtMs > input.maximumFutureSkewMs) {
    return "invalid";
  }
  if (input.sampleCount === 0) {
    return "missing";
  }
  if (acquiredAtMs - observedAtMs > input.maximumAgeMs) {
    return "stale";
  }
  if (input.sampleCount < input.minimumSamples) {
    return "insufficient";
  }
  return "valid";
}
