import { describe, expect, it } from "vitest";
import {
  EvidenceStore,
  GateError,
  type AssertionResult,
  type Evidence,
  type PlannedGate
} from "@observability-gate/core";
import {
  executeGate,
  GateCatalog,
  type GateContext,
  type GateTypeDefinition
} from "../src/index.js";

type Acquire = (context: GateContext) => Promise<readonly Evidence<number>[]>;

function evidence(state: Evidence<number>["state"] = "valid"): Evidence<number> {
  return {
    id: `evidence-${state}`,
    kind: "metrics.vector",
    state,
    source: { provider: "metrics", capability: "query" },
    target: "aks-checkout",
    acquiredAt: "2026-10-06T07:30:00.000Z",
    observedAt: "2026-10-06T07:29:30.000Z",
    ...(state === "valid" ? { value: 42 } : {}),
    diagnostics: []
  };
}

function assertion(status: AssertionResult["status"]): AssertionResult {
  return {
    assertion: "threshold",
    status,
    observed: 42,
    expected: 40,
    message: `Assertion ${status}.`
  };
}

function gate(overrides: Partial<PlannedGate> = {}): PlannedGate {
  return {
    index: 0,
    id: "release.error-rate",
    name: "Candidate error rate",
    type: "test.gate",
    enforcement: "blocking",
    applicability: "applicable",
    timeoutMs: 100,
    providerRequirements: [],
    definition: {},
    ...overrides
  };
}

function context(signal: AbortSignal = new AbortController().signal): GateContext {
  return {
    phase: "post_deployment",
    targetId: "aks-checkout",
    releaseId: "release-1",
    evidenceStore: new EvidenceStore(),
    signal,
    clock: () => new Date("2026-10-06T07:30:00.000Z"),
    missingEvidenceBehavior: {
      blocking: "inconclusive",
      advisory: "warn"
    }
  };
}

function catalog(
  acquire: Acquire,
  assertions: readonly AssertionResult[] = [assertion("passed")]
): GateCatalog {
  const definition: GateTypeDefinition<Record<string, never>, number> = {
    type: "test.gate",
    description: "Test gate",
    supportedPhases: ["post_deployment"],
    providerRequirements: [],
    parseDefinition() {
      return {};
    },
    async acquire(_definition, gateContext) {
      return acquire(gateContext);
    },
    evaluate() {
      return assertions;
    }
  };
  return new GateCatalog().register(definition);
}

describe("executeGate", () => {
  it("returns passed when evidence and assertions pass", async () => {
    const result = await executeGate(
      gate(),
      catalog(async () => [evidence()]),
      context()
    );

    expect(result.status).toBe("passed");
    expect(result.evidence).toHaveLength(1);
  });

  it("maps threshold misses to failed or warned by enforcement", async () => {
    const evaluator = catalog(async () => [evidence()], [assertion("failed")]);

    expect((await executeGate(gate(), evaluator, context())).status).toBe("failed");
    expect(
      (await executeGate(gate({ enforcement: "advisory" }), evaluator, context())).status
    ).toBe("warned");
  });

  it("returns skipped without acquiring evidence", async () => {
    let acquired = false;
    const result = await executeGate(
      gate({ applicability: "skipped", skipReason: "Not Kubernetes." }),
      catalog(async () => {
        acquired = true;
        return [evidence()];
      }),
      context()
    );

    expect(result.status).toBe("skipped");
    expect(acquired).toBe(false);
  });

  it("keeps missing evidence inconclusive under the configured policy", async () => {
    const result = await executeGate(
      gate(),
      catalog(async () => [evidence("missing")]),
      context()
    );

    expect(result.status).toBe("inconclusive");
  });

  it("turns authorization failures into safe error results", async () => {
    const result = await executeGate(
      gate(),
      catalog(async () => {
        throw new GateError({
          code: "AUTHORIZATION",
          safeMessage: "Metrics access is forbidden.",
          retryable: false,
          cause: new Error("Bearer secret-token")
        });
      }),
      context()
    );

    expect(result.status).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("AUTHORIZATION");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });

  it("returns error when the gate deadline expires", async () => {
    const result = await executeGate(
      gate({ timeoutMs: 5 }),
      catalog(
        (gateContext) =>
          new Promise((resolve) => {
            gateContext.signal.addEventListener("abort", () => resolve([]), { once: true });
          })
      ),
      context()
    );

    expect(result.status).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("GATE_EVALUATION");
  });

  it("returns cancelled error when the parent signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await executeGate(
      gate(),
      catalog(async () => [evidence()]),
      context(controller.signal)
    );

    expect(result.status).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("CANCELLED");
  });
});
