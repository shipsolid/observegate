import type { Diagnostic, ExecutionPlan, ExecutionResult } from "@observability-gate/core";

export interface OutputWriter {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export function exitCodeForDecision(decision: ExecutionResult["decision"]): number {
  switch (decision) {
    case "pass":
    case "warn":
      return 0;
    case "fail":
      return 1;
    case "inconclusive":
      return 2;
    case "error":
      return 3;
  }
}

export function safePlanDto(plan: ExecutionPlan): Readonly<Record<string, unknown>> {
  return {
    phase: plan.phase,
    targetId: plan.targetId,
    runtimeType: plan.runtimeType,
    deadlineMs: plan.deadlineMs,
    gates: plan.gates.map((gate) => ({
      id: gate.id,
      name: gate.name,
      type: gate.type,
      enforcement: gate.enforcement,
      applicability: gate.applicability,
      ...(gate.skipReason === undefined ? {} : { skipReason: gate.skipReason }),
      timeoutMs: gate.timeoutMs,
      providers: gate.providerRequirements.map(({ provider, capability, required }) => ({
        provider,
        capability,
        required
      }))
    })),
    requiredProviders: plan.requiredProviders
  };
}

export function writeDiagnostics(
  diagnostics: readonly Diagnostic[],
  output: OutputWriter,
  json: boolean
): void {
  if (diagnostics.length === 0) return;
  output.stderr(
    json
      ? `${JSON.stringify({ diagnostics }, null, 2)}\n`
      : `${diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n")}\n`
  );
}

export function writeResult(result: ExecutionResult, output: OutputWriter, json: boolean): void {
  if (json) {
    output.stdout(
      `${JSON.stringify({
        decision: result.decision,
        phase: result.phase,
        targetId: result.target.id,
        releaseId: result.release.candidateId,
        evidenceCoveragePercent: result.evidenceCoveragePercent,
        gates: result.gates.map(({ id, status, enforcement }) => ({ id, status, enforcement }))
      })}\n`
    );
  } else {
    output.stdout(
      `Decision: ${result.decision}\nPhase: ${result.phase}\nTarget: ${result.target.id}\nRelease: ${result.release.candidateId}\nEvidence coverage: ${result.evidenceCoveragePercent}%\n`
    );
  }
  writeDiagnostics(result.diagnostics, output, json);
}
