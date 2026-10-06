import type { Diagnostic, Decision, GateResult, Phase } from "./gates.js";
import type { ReleaseIdentity, TargetIdentity } from "./identity.js";

export interface ExecutionRequest {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly phase: Phase;
  readonly targetOverride?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly cancellationSignal: AbortSignal;
}

export interface ExecutionResult {
  readonly decision: Decision;
  readonly phase: Phase;
  readonly target: TargetIdentity;
  readonly release: ReleaseIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly evidenceCoveragePercent: number;
  readonly configurationFingerprint?: string;
  readonly gates: readonly GateResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly links: Readonly<Record<string, string>>;
}
