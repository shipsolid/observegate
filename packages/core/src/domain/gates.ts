import type { EvidenceState } from "../evidence/states.js";

export type Phase = "pre_deployment" | "post_deployment";
export type Decision = "pass" | "warn" | "fail" | "inconclusive" | "error";
export type GateStatus = "passed" | "warned" | "failed" | "inconclusive" | "error" | "skipped";
export type Enforcement = "blocking" | "advisory";

export interface AssertionResult {
  readonly assertion: string;
  readonly status: Exclude<GateStatus, "skipped">;
  readonly expected?: unknown;
  readonly observed?: unknown;
  readonly unit?: string;
  readonly message: string;
  readonly children?: readonly AssertionResult[];
  readonly diagnostic?: Diagnostic;
  readonly requiredPassCount?: number;
  readonly observedPassCount?: number;
  readonly window?: string;
  readonly sampleCount?: number;
}

export interface EvidenceReference {
  readonly id: string;
  readonly kind: string;
  readonly provider: string;
  readonly state?: EvidenceState;
  readonly capability?: string;
  readonly target?: string;
  readonly releaseId?: string;
  readonly expiresAt?: string;
  readonly observedAt?: string;
  readonly acquiredAt: string;
  readonly ageMs?: number;
  readonly fingerprint: string;
}

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly gateId?: string;
  readonly artifactLocation?: {
    readonly uri: string;
    readonly line?: number;
    readonly column?: number;
  };
}

export interface GateDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly phase: Phase;
  readonly enforcement: Enforcement;
  readonly assertions: readonly Readonly<Record<string, unknown>>[];
  readonly when?: Readonly<Record<string, unknown>>;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly remediation?: string;
}

export interface GateResult {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly phase: Phase;
  readonly enforcement: Enforcement;
  readonly status: GateStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly assertions: readonly AssertionResult[];
  readonly evidence: readonly EvidenceReference[];
  readonly diagnostics: readonly Diagnostic[];
  readonly remediation?: string;
}

export function createGateResult(input: GateResult): GateResult {
  return Object.freeze({
    ...input,
    assertions: Object.freeze([...input.assertions]),
    evidence: Object.freeze([...input.evidence]),
    diagnostics: Object.freeze([...input.diagnostics])
  });
}
