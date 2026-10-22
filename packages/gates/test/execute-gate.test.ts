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
  assertions: readonly AssertionResult[] = [assertion("passed")],
  type = "test.gate"
): GateCatalog {
  const definition: GateTypeDefinition<Record<string, never>, number> = {
    type,
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

  it("preserves capability and validity in evidence references", async () => {
    const result = await executeGate(
      gate(),
      catalog(async () => [evidence()]),
      context()
    );
    expect(result.evidence[0]).toMatchObject({
      state: "valid",
      capability: "query",
      target: "aks-checkout"
    });
  });

  it("classifies mixed evidence states and diagnostics independently of acquisition order", async () => {
    const missing = evidence("missing");
    const unavailable = evidence("unavailable");
    const first = await executeGate(
      gate(),
      catalog(async () => [missing, unavailable]),
      context()
    );
    const second = await executeGate(
      gate(),
      catalog(async () => [unavailable, missing]),
      context()
    );
    expect(first.status).toBe("error");
    expect(first.status).toBe(second.status);
    expect(first.diagnostics).toEqual(second.diagnostics);
  });

  it("rejects empty assertions and mismatched or expired evidence", async () => {
    expect(
      (
        await executeGate(
          gate(),
          catalog(async () => [evidence()], []),
          context()
        )
      ).status
    ).not.toBe("passed");
    for (const item of [
      { ...evidence(), target: "different-workload" },
      { ...evidence(), releaseId: "different-release" },
      { ...evidence(), expiresAt: "2026-10-06T07:29:00.000Z" }
    ]) {
      expect(
        (
          await executeGate(
            gate(),
            catalog(async () => [item]),
            context()
          )
        ).status
      ).not.toBe("passed");
    }
  });

  it("accepts the verified baseline only for comparison evidence", async () => {
    const scoped = { ...context(), baselineReleaseId: "release-0" };
    const type = "comparison.metric";
    expect(
      (
        await executeGate(
          gate({ type }),
          catalog(async () => [{ ...evidence(), releaseId: "release-0" }], undefined, type),
          scoped
        )
      ).status
    ).toBe("passed");
    expect(
      (
        await executeGate(
          gate({ type }),
          catalog(
            async () => [{ ...evidence(), releaseId: "unexpected-release" }],
            undefined,
            type
          ),
          scoped
        )
      ).status
    ).toBe("error");
    expect(
      (
        await executeGate(
          gate(),
          catalog(async () => [{ ...evidence(), releaseId: "release-0" }]),
          scoped
        )
      ).status
    ).toBe("error");
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

  it("honors synthetic and comparison no-data overrides", async () => {
    for (const type of ["synthetic.result", "comparison.metric"]) {
      const custom = new GateCatalog().register({
        type,
        description: "specialized no-data",
        supportedPhases: ["post_deployment"],
        providerRequirements: [],
        parseDefinition: () => ({}),
        acquire: async () => [evidence("missing")],
        evaluate: () => []
      });
      const scoped = {
        ...context(),
        missingEvidenceBehavior: {
          blocking: "fail" as const,
          advisory: "warn" as const,
          comparison: "inconclusive" as const,
          synthetic: "inconclusive" as const
        }
      };
      expect((await executeGate(gate({ type }), custom, scoped)).status).toBe("inconclusive");
    }
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
