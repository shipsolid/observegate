import {
  createGateResult,
  raceWithSignal,
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
      capability: item.source.capability,
      state: item.state,
      target: item.target,
      ...(item.releaseId === undefined ? {} : { releaseId: item.releaseId }),
      ...(item.expiresAt === undefined ? {} : { expiresAt: item.expiresAt }),
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
  if (assertions.length === 0) return "inconclusive";
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
    acquired = await raceWithSignal(resolved.acquire(scopedContext), controller.signal);

    const now = context.clock().getTime();
    acquired = acquired.map((item) => {
      if (item.state !== "valid") return item;
      const mismatched =
        item.target !== context.targetId ||
        (item.releaseId !== undefined &&
          context.releaseId !== undefined &&
          item.releaseId !== context.releaseId &&
          !(
            gate.type.startsWith("comparison.") &&
            context.baselineReleaseId !== undefined &&
            item.releaseId === context.baselineReleaseId
          ));
      const expiry = item.expiresAt === undefined ? undefined : Date.parse(item.expiresAt);
      const state =
        mismatched || (expiry !== undefined && !Number.isFinite(expiry))
          ? "invalid"
          : expiry !== undefined && expiry < now
            ? "stale"
            : "valid";
      return state === "valid" ? item : Object.freeze({ ...item, state });
    });
    // Provider failures outrank no-data states, regardless of completion order.
    const precedence = [
      "unsupported",
      "invalid",
      "unavailable",
      "missing",
      "stale",
      "insufficient"
    ] as const;
    const state = precedence.find((candidate) => acquired.some((item) => item.state === candidate));
    if (acquired.length === 0 || state !== undefined) {
      const diagnostics = acquired.flatMap((item) =>
        item.state === "valid"
          ? []
          : item.diagnostics.length > 0
            ? item.diagnostics
            : [
                {
                  code:
                    item.state === "unsupported" ? "CAPABILITY_UNSUPPORTED" : "EVIDENCE_INVALID",
                  message: `Evidence is ${item.state}.`,
                  retryable: item.state === "unavailable",
                  gateId: gate.id
                }
              ]
      );
      if (diagnostics.length === 0)
        diagnostics.push({
          code: "EVIDENCE_INVALID",
          message: "Evidence is missing.",
          retryable: false,
          gateId: gate.id
        });
      const stableDiagnostics = [
        ...new Map(diagnostics.map((item) => [JSON.stringify(item), item])).entries()
      ]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, item]) => item);
      const isError = state === "unsupported" || state === "invalid" || state === "unavailable";
      const overrides = context.missingEvidenceBehavior;
      const behavior =
        (gate.type.startsWith("comparison.")
          ? overrides.comparison
          : gate.type === "synthetic.result"
            ? overrides.synthetic
            : undefined) ?? overrides[gate.enforcement];
      return result(
        gate,
        context,
        startedAt,
        isError ? "error" : statusForMissing(behavior, gate.enforcement),
        [],
        acquired,
        stableDiagnostics
      );
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
