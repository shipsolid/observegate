import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  EvidenceStore,
  ExecutionScheduler,
  stableFingerprint,
  type ExecutionResult,
  type GateResult,
  type PlannedGate
} from "@observability-gate/core";
import { createExecutionPlan, parsePolicy } from "@observability-gate/config";
import { createBuiltInGateCatalog } from "@observability-gate/gates";
import { renderJson } from "@observability-gate/reporters";
import { beforeAll, describe, expect, it } from "vitest";

function resultFor(gate: PlannedGate): GateResult {
  return {
    id: gate.id,
    name: gate.name,
    type: gate.type,
    phase: "pre_deployment",
    enforcement: gate.enforcement,
    status: "passed",
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:00:00.001Z",
    durationMs: 1,
    assertions: [],
    evidence: [],
    diagnostics: []
  };
}

function gates(count: number): readonly PlannedGate[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    id: `gate-${index}`,
    name: `Gate ${index}`,
    type: "identity.contract",
    enforcement: "blocking" as const,
    applicability: "applicable" as const,
    timeoutMs: 5_000,
    providerRequirements: [{ provider: "metrics", capability: "query", required: true }],
    definition: {}
  }));
}

describe("execution performance budgets", () => {
  let policyText = "";

  beforeAll(async () => {
    policyText = await readFile("fixtures/configs/minimal-valid.yml", "utf8");
  });

  it("plans 200 gates in under 250 milliseconds", () => {
    const policy = parsePolicy(policyText);
    policy.gates.pre_deployment = Array.from({ length: 200 }, (_, index) => ({
      id: `readiness.identity-${index}`,
      name: `Identity ${index}`,
      type: "identity.contract"
    }));
    const started = performance.now();
    const plan = createExecutionPlan({
      policy,
      phase: "pre_deployment",
      catalog: createBuiltInGateCatalog().metadata()
    });
    const elapsed = performance.now() - started;

    expect(plan.gates).toHaveLength(200);
    expect(elapsed).toBeLessThan(250);
  });

  it("renders a bounded 200-gate report in under 500 milliseconds", () => {
    const planned = gates(200);
    const execution: ExecutionResult = {
      decision: "pass",
      phase: "pre_deployment",
      target: { id: "checkout", runtimeType: "kubernetes", provider: "kubernetes" },
      release: { candidateId: "release-candidate", deploymentId: "deployment-1" },
      startedAt: "2026-10-07T00:00:00.000Z",
      completedAt: "2026-10-07T00:00:01.000Z",
      evidenceCoveragePercent: 100,
      gates: planned.map(resultFor),
      diagnostics: [],
      links: {}
    };
    const started = performance.now();
    const report = renderJson(execution);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(Buffer.byteLength(report)).toBeLessThan(2 * 1024 * 1024);
  });

  it("loads identical evidence exactly once", async () => {
    const store = new EvidenceStore(() => new Date("2026-10-07T00:00:00.000Z"));
    let calls = 0;
    const request = {
      kind: "metrics.vector",
      provider: "metrics",
      capability: "query",
      target: "checkout",
      query: "up"
    };
    const acquired = await Promise.all(
      Array.from({ length: 200 }, () =>
        store.getOrLoad(request, async () => {
          calls += 1;
          return {
            id: stableFingerprint(request),
            kind: request.kind,
            state: "valid" as const,
            source: { provider: request.provider, capability: request.capability },
            target: request.target,
            acquiredAt: "2026-10-07T00:00:00.000Z",
            value: { value: 1 },
            diagnostics: []
          };
        })
      )
    );

    expect(calls).toBe(1);
    expect(new Set(acquired.map((item) => item.id)).size).toBe(1);
  });

  it("never exceeds four concurrent requests for one provider", async () => {
    let active = 0;
    let maximum = 0;
    const planned = gates(40);
    const scheduler = new ExecutionScheduler({
      globalConcurrency: 20,
      perProviderConcurrency: 4
    });

    const results = await scheduler.run({
      phase: "pre_deployment",
      gates: planned,
      phaseDeadlineMs: 10_000,
      signal: new AbortController().signal,
      execute: async (gate) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return resultFor(gate);
      }
    });

    expect(results).toHaveLength(40);
    expect(maximum).toBe(4);
  });
});
