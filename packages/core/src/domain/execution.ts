import type { Diagnostic, Decision, GateResult, Phase } from "./gates.js";
import type { ReleaseIdentity, TargetIdentity } from "./identity.js";

export interface ProviderTiming {
  readonly provider: string;
  readonly calls: number;
  readonly durationMs: number;
}

export interface ExecutionEvent {
  readonly name: "configuration_loaded" | "execution_planned" | "provider_request_started" |
    "provider_request_completed" | "provider_request_retried" | "evidence_acquired" |
    "evidence_rejected" | "gate_completed" | "decision_completed" | "report_written";
  readonly at: string;
  readonly phase?: Phase;
  readonly provider?: string;
  readonly gateId?: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly attempt?: number;
  readonly decision?: Decision;
}

export interface ExecutionRequest {
  readonly workspaceRoot: string;
  readonly configPath: string;
  readonly phase: Phase;
  readonly targetOverride?: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly cancellationSignal: AbortSignal;
  readonly onEvent?: (event: ExecutionEvent) => void;
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
  readonly artifactRetentionDays?: number;
  readonly providerTimings?: readonly ProviderTiming[];
  readonly gates: readonly GateResult[];
  readonly diagnostics: readonly Diagnostic[];
  readonly links: Readonly<Record<string, string>>;
}
