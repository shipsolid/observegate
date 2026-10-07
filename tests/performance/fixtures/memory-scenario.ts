import { renderJson } from "../../../packages/reporters/src/json.ts";
import type { ExecutionResult } from "../../../packages/core/src/domain/execution.ts";
import type { GateResult } from "../../../packages/core/src/domain/gates.ts";

const gateCount = 200;
const assertionsPerGate = 12;
const evidencePerGate = 12;

function gate(index: number, retainedEvidence: { readonly data: string }): GateResult {
  const padding = retainedEvidence.data.slice(0, 900);
  return {
    id: `gate-${index}`,
    name: `Worst-case gate ${index}`,
    type: "telemetry.contract",
    phase: "post_deployment",
    enforcement: "blocking",
    status: "passed",
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:00:01.000Z",
    durationMs: 1_000,
    assertions: Array.from({ length: assertionsPerGate }, (_, assertionIndex) => ({
      assertion: `assertion-${assertionIndex}`,
      status: "passed" as const,
      expected: `${index}-${assertionIndex}-expected-${padding}`,
      observed: `${index}-${assertionIndex}-observed-${padding}`,
      message: `${index}-${assertionIndex}-message-${padding}`,
      unit: "ratio",
      window: "5m",
      sampleCount: 1_000
    })),
    evidence: Array.from({ length: evidencePerGate }, (_, evidenceIndex) => ({
      id: `evidence-${index}-${evidenceIndex}`,
      kind: "metrics.matrix",
      provider: "metrics",
      observedAt: "2026-10-07T00:00:00.000Z",
      acquiredAt: "2026-10-07T00:00:01.000Z",
      ageMs: 1_000,
      fingerprint: `${index.toString(16).padStart(4, "0")}${evidenceIndex.toString(16).padStart(4, "0")}${"f".repeat(56)}`
    })),
    diagnostics: []
  };
}

export interface MemoryScenarioMetrics {
  readonly gateCount: number;
  readonly responseBytes: number;
  readonly reportBytes: number;
  readonly retainedHeapBytes: number;
}

export function runMemoryScenario(): MemoryScenarioMetrics {
  const maximumProviderResponseBytes = 2 * 1024 * 1024;
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  const responseText = JSON.stringify({
    data: "e".repeat(maximumProviderResponseBytes - 32)
  });
  const responseBytes = Buffer.byteLength(responseText);
  const retainedEvidence = JSON.parse(responseText) as { readonly data: string };
  const execution: ExecutionResult = {
    decision: "pass",
    phase: "post_deployment",
    target: { id: "production", runtimeType: "kubernetes", provider: "kubernetes" },
    release: { candidateId: "release-candidate", deploymentId: "deployment-1" },
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:01:00.000Z",
    evidenceCoveragePercent: 100,
    gates: Array.from({ length: gateCount }, (_, index) => gate(index, retainedEvidence)),
    diagnostics: [],
    links: {}
  };
  const report = renderJson(execution);
  return {
    gateCount,
    responseBytes,
    reportBytes: Buffer.byteLength(report),
    retainedHeapBytes: Math.max(0, process.memoryUsage().heapUsed - baselineHeapBytes)
  };
}
