import type {
  AssertionResult,
  Diagnostic,
  EvidenceReference,
  ExecutionResult,
  GateResult
} from "@observability-gate/core";
import { collectChunks, jsonChunks } from "./chunks.js";

function assertionDto(assertion: AssertionResult): Readonly<Record<string, unknown>> {
  return {
    assertion: assertion.assertion,
    status: assertion.status,
    ...(assertion.expected === undefined ? {} : { expected: assertion.expected }),
    ...(assertion.observed === undefined ? {} : { observed: assertion.observed }),
    ...(assertion.unit === undefined ? {} : { unit: assertion.unit }),
    message: assertion.message,
    ...(assertion.window === undefined ? {} : { window: assertion.window }),
    ...(assertion.sampleCount === undefined ? {} : { sampleCount: assertion.sampleCount }),
    ...(assertion.requiredPassCount === undefined
      ? {}
      : { requiredPassCount: assertion.requiredPassCount }),
    ...(assertion.observedPassCount === undefined
      ? {}
      : { observedPassCount: assertion.observedPassCount }),
    ...(assertion.children === undefined ? {} : { children: assertion.children.map(assertionDto) }),
    ...(assertion.diagnostic === undefined
      ? {}
      : { diagnostic: diagnosticDto(assertion.diagnostic) })
  };
}

function evidenceDto(evidence: EvidenceReference): Readonly<Record<string, unknown>> {
  return {
    id: evidence.id,
    kind: evidence.kind,
    provider: evidence.provider,
    ...(evidence.state === undefined ? {} : { state: evidence.state }),
    ...(evidence.capability === undefined ? {} : { capability: evidence.capability }),
    ...(evidence.target === undefined ? {} : { target: evidence.target }),
    ...(evidence.releaseId === undefined ? {} : { releaseId: evidence.releaseId }),
    ...(evidence.expiresAt === undefined ? {} : { expiresAt: evidence.expiresAt }),
    ...(evidence.observedAt === undefined ? {} : { observedAt: evidence.observedAt }),
    acquiredAt: evidence.acquiredAt,
    ...(evidence.ageMs === undefined ? {} : { ageMs: evidence.ageMs }),
    fingerprint: evidence.fingerprint
  };
}

function diagnosticDto(diagnostic: Diagnostic): Readonly<Record<string, unknown>> {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    retryable: diagnostic.retryable,
    ...(diagnostic.provider === undefined ? {} : { provider: diagnostic.provider }),
    ...(diagnostic.gateId === undefined ? {} : { gateId: diagnostic.gateId }),
    ...(diagnostic.artifactLocation === undefined
      ? {}
      : { artifactLocation: { ...diagnostic.artifactLocation } })
  };
}

function gateDto(gate: GateResult): Readonly<Record<string, unknown>> {
  return {
    id: gate.id,
    name: gate.name,
    type: gate.type,
    phase: gate.phase,
    enforcement: gate.enforcement,
    status: gate.status,
    startedAt: gate.startedAt,
    completedAt: gate.completedAt,
    durationMs: gate.durationMs,
    assertions: gate.assertions.map(assertionDto),
    evidence: gate.evidence.map(evidenceDto),
    diagnostics: gate.diagnostics.map(diagnosticDto),
    ...(gate.remediation === undefined ? {} : { remediation: gate.remediation })
  };
}

export function executionReportDto(result: ExecutionResult): Readonly<Record<string, unknown>> {
  return {
    decision: result.decision,
    phase: result.phase,
    target: {
      id: result.target.id,
      runtimeType: result.target.runtimeType,
      provider: result.target.provider
    },
    release: {
      candidateId: result.release.candidateId,
      deploymentId: result.release.deploymentId,
      ...(result.release.baselineId === undefined ? {} : { baselineId: result.release.baselineId })
    },
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    evidenceCoveragePercent: result.evidenceCoveragePercent,
    ...(result.artifactRetentionDays === undefined
      ? {}
      : { artifactRetentionDays: result.artifactRetentionDays }),
    ...(result.configurationFingerprint === undefined
      ? {}
      : { configurationFingerprint: result.configurationFingerprint }),
    gates: result.gates.map(gateDto),
    diagnostics: result.diagnostics.map(diagnosticDto),
    links: Object.fromEntries(
      Object.entries(result.links).sort(([left], [right]) => left.localeCompare(right))
    )
  };
}

export function renderJson(result: ExecutionResult): string {
  return collectChunks(jsonReportChunks(result));
}

export function* jsonReportChunks(result: ExecutionResult): Iterable<string> {
  yield* jsonChunks(executionReportDto(result));
  yield "\n";
}
