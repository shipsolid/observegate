import {
  createGateResult,
  GateError,
  type AssertionResult,
  type Diagnostic,
  type Evidence,
  type EvidenceReference,
  type GateResult,
  type GateStatus,
  type PlannedGate
} from "@observability-gate/core";
import type { GateCatalog } from "../catalog/registry.js";
import type { GateContext, MissingEvidenceBehavior } from "./context.js";

function evidenceReferences(evidence: readonly Evidence<unknown>[]): readonly EvidenceReference[] {
  return evidence.map((item) => {
    const observedAtMs = item.observedAt === undefined ? undefined : Date.parse(item.observedAt);
    const acquiredAtMs = Date.parse(item.acquiredAt);
    const ageMs =
      observedAtMs === undefined || !Number.isFinite(observedAtMs) || !Number.isFinite(acquiredAtMs)
        ? undefined
        : Math.max(0, acquiredAtMs - observedAtMs);
    return Object.freeze({
      id: item.id,
      kind: item.kind,
      provider: item.source.provider,
      ...(item.observedAt === undefined ? {} : { observedAt: item.observedAt }),
      acquiredAt: item.acquiredAt,
      ...(ageMs === undefined ? {} : { ageMs }),
      fingerprint: item.id
    });
  });
}

function result(
  gate: PlannedGate,
  context: GateContext,
  startedAt: Date,
  status: GateStatus,
  assertions: readonly AssertionResult[] = [],
  evidence: readonly Evidence<unknown>[] = [],
  diagnostics: readonly Diagnostic[] = []
): GateResult {
  const completedAt = context.clock();
  const remediation = gate.definition.remediation;
  return createGateResult({
    id: gate.id,
    name: gate.name,
    type: gate.type,
    phase: context.phase,
    enforcement: gate.enforcement,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    assertions,
    evidence: evidenceReferences(evidence),
    diagnostics,
    ...(typeof remediation === "string" ? { remediation } : {})
  });
}

function statusForMissing(
  behavior: MissingEvidenceBehavior,
  enforcement: PlannedGate["enforcement"]
): GateStatus {
  if (behavior === "inconclusive") {
    return "inconclusive";
  }
  if (behavior === "warn" || enforcement === "advisory") {
    return "warned";
  }
  return "failed";
}

function assertionStatus(
  assertions: readonly AssertionResult[],
  enforcement: PlannedGate["enforcement"]
): GateStatus {
  if (assertions.some((assertion) => assertion.status === "error")) {
    return "error";
  }
  if (assertions.some((assertion) => assertion.status === "inconclusive")) {
    return enforcement === "advisory" ? "warned" : "inconclusive";
  }
  if (assertions.some((assertion) => assertion.status !== "passed")) {
    return enforcement === "advisory" ? "warned" : "failed";
  }
  return "passed";
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export async function executeGate(
  gate: PlannedGate,
  catalog: GateCatalog,
  context: GateContext
): Promise<GateResult> {
  const startedAt = context.clock();
  if (gate.applicability === "skipped") {
    return result(gate, context, startedAt, "skipped");
  }
  if (context.signal.aborted) {
    return result(
      gate,
      context,
      startedAt,
      "error",
      [],
      [],
      [{ code: "CANCELLED", message: "Gate execution was cancelled.", retryable: false }]
    );
  }

  const controller = new AbortController();
  const cancel = () =>
    controller.abort(
      new GateError({
        code: "CANCELLED",
        safeMessage: "Gate execution was cancelled.",
        retryable: false
      })
    );
  context.signal.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(
        new GateError({
          code: "GATE_EVALUATION",
          safeMessage: `Gate execution exceeded ${gate.timeoutMs} ms.`,
          retryable: false,
          gateId: gate.id
        })
      ),
    gate.timeoutMs
  );

  let acquired: readonly Evidence<unknown>[] = [];
  try {
    const resolved = catalog.require(gate.type, context.phase, gate.definition);
    const scopedContext: GateContext = { ...context, signal: controller.signal };
    acquired = await Promise.race([
      resolved.acquire(scopedContext),
      abortPromise(controller.signal)
    ]);

    const nonValid = acquired.find((item) => item.state !== "valid");
    if (
      acquired.length === 0 ||
      nonValid?.state === "missing" ||
      nonValid?.state === "stale" ||
      nonValid?.state === "insufficient"
    ) {
      const behavior = context.missingEvidenceBehavior[gate.enforcement];
      return result(
        gate,
        context,
        startedAt,
        statusForMissing(behavior, gate.enforcement),
        [],
        acquired,
        [
          {
            code: "EVIDENCE_INVALID",
            message: `Evidence is ${nonValid?.state ?? "missing"}.`,
            retryable: false,
            gateId: gate.id
          }
        ]
      );
    }
    if (nonValid !== undefined) {
      const diagnostics =
        nonValid.diagnostics.length > 0
          ? nonValid.diagnostics
          : [
              {
                code:
                  nonValid.state === "unsupported" ? "CAPABILITY_UNSUPPORTED" : "EVIDENCE_INVALID",
                message: `Evidence is ${nonValid.state}.`,
                retryable: nonValid.state === "unavailable",
                gateId: gate.id
              }
            ];
      return result(gate, context, startedAt, "error", [], acquired, diagnostics);
    }

    const assertions = resolved.evaluate(acquired, scopedContext);
    return result(
      gate,
      context,
      startedAt,
      assertionStatus(assertions, gate.enforcement),
      assertions,
      acquired
    );
  } catch (error) {
    const gateError =
      error instanceof GateError
        ? error
        : new GateError({
            code: "INTERNAL",
            safeMessage: "Gate execution failed unexpectedly.",
            retryable: false,
            gateId: gate.id,
            cause: error
          });
    return result(gate, context, startedAt, "error", [], acquired, [gateError.toDiagnostic()]);
  } finally {
    clearTimeout(timeout);
    context.signal.removeEventListener("abort", cancel);
  }
}
