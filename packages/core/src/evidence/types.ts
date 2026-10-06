import type { Diagnostic } from "../domain/gates.js";
import type { EvidenceState } from "./states.js";

export interface EvidenceSource {
  readonly provider: string;
  readonly capability: string;
  readonly queryFingerprint?: string;
}

export interface Evidence<T> {
  readonly id: string;
  readonly kind: string;
  readonly state: EvidenceState;
  readonly source: EvidenceSource;
  readonly target: string;
  readonly releaseId?: string;
  readonly acquiredAt: string;
  readonly observedAt?: string;
  readonly expiresAt?: string;
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
}

export interface EvidenceRange {
  readonly start: string;
  readonly end: string;
  readonly stepMs?: number;
}

export interface EvidenceRequest<T = unknown> {
  readonly kind: string;
  readonly provider: string;
  readonly capability: string;
  readonly target: string;
  readonly releaseId?: string;
  readonly range?: EvidenceRange;
  readonly query?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly expectedValueType?: T;
}

export type EvidenceLoader<T> = () => Promise<Evidence<T>>;
