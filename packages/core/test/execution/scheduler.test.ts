import { describe, expect, it, vi } from "vitest";
import {
  createGateResult,
  ExecutionScheduler,
  runPhase,
  type ExecutionPlan,
  type PlannedGate
} from "../../src/index.js";

function gate(index: number, provider = "metrics"): PlannedGate {
  return Object.freeze({
    index,
    id: `gate-${index}`,
    name: `Gate ${index}`,
    type: "test.gate",
    enforcement: "blocking",
    applicability: "applicable",
    timeoutMs: 1_000,
    providerRequirements: Object.freeze([
      Object.freeze({ provider, capability: "query", required: true })
    ]),
    definition: Object.freeze({})
  });
}

function result(item: PlannedGate) {
  return createGateResult({
    id: item.id,
    name: item.name,
    type: item.type,
    phase: "pre_deployment",
    enforcement: item.enforcement,
    status: "passed",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 0,
    assertions: [],
    evidence: [],
    diagnostics: []
  });
}

describe("ExecutionScheduler", () => {
  it("bounds global and per-provider concurrency while preserving configuration order", async () => {
    const items = Array.from({ length: 16 }, (_, index) =>
      gate(index, index < 12 ? "metrics" : "logs")
    );
    let globalActive = 0;
    let globalPeak = 0;
    const providerActive = new Map<string, number>();
    const providerPeak = new Map<string, number>();

    const scheduler = new ExecutionScheduler({ globalConcurrency: 8, perProviderConcurrency: 4 });
    const results = await scheduler.run({
      phase: "pre_deployment",
      gates: items,
      phaseDeadlineMs: 5_000,
      signal: new AbortController().signal,
      execute: async (item) => {
        const provider = item.providerRequirements[0]?.provider ?? "none";
        globalActive += 1;
        globalPeak = Math.max(globalPeak, globalActive);
        const active = (providerActive.get(provider) ?? 0) + 1;
        providerActive.set(provider, active);
        providerPeak.set(provider, Math.max(providerPeak.get(provider) ?? 0, active));
        await new Promise((resolve) => setTimeout(resolve, 5 + (items.length - item.index)));
        providerActive.set(provider, active - 1);
        globalActive -= 1;
        return result(item);
      }
    });

    expect(globalPeak).toBeLessThanOrEqual(8);
    expect([...providerPeak.values()].every((peak) => peak <= 4)).toBe(true);
    expect(results.map((item) => item.id)).toEqual(items.map((item) => item.id));
  });

  it("shares one evidence store for the phase and does not fail fast", async () => {
    const seenStores = new Set<unknown>();
    const executed: string[] = [];
    const scheduler = new ExecutionScheduler({ globalConcurrency: 2, perProviderConcurrency: 1 });

    const results = await scheduler.run({
      phase: "pre_deployment",
      gates: [gate(0), gate(1)],
      phaseDeadlineMs: 5_000,
      signal: new AbortController().signal,
      execute: async (item, context) => {
        seenStores.add(context.evidenceStore);
        executed.push(item.id);
        const current = result(item);
        return item.index === 0 ? createGateResult({ ...current, status: "failed" }) : current;
      }
    });

    expect(seenStores.size).toBe(1);
    expect(executed).toEqual(["gate-0", "gate-1"]);
    expect(results.map((item) => item.status)).toEqual(["failed", "passed"]);
  });

  it("cancels queued work and never waits for an uncooperative gate", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const scheduler = new ExecutionScheduler({ globalConcurrency: 1, perProviderConcurrency: 1 });
    const running = scheduler.run({
      phase: "pre_deployment",
      gates: [gate(0), gate(1)],
      phaseDeadlineMs: 10_000,
      signal: controller.signal,
      execute: async () => new Promise(() => undefined)
    });

    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    const results = await running;

    expect(results).toHaveLength(2);
    expect(results.every((item) => item.status === "error")).toBe(true);
    expect(results.every((item) => item.diagnostics[0]?.code === "CANCELLED")).toBe(true);
    vi.useRealTimers();
  });

  it("enforces the overall phase deadline", async () => {
    vi.useFakeTimers();
    const scheduler = new ExecutionScheduler({ globalConcurrency: 1, perProviderConcurrency: 1 });
    const running = scheduler.run({
      phase: "pre_deployment",
      gates: [gate(0)],
      phaseDeadlineMs: 50,
      signal: new AbortController().signal,
      execute: async () => new Promise(() => undefined)
    });

    await vi.advanceTimersByTimeAsync(51);
    const [timedOut] = await running;
    expect(timedOut?.status).toBe("error");
    expect(timedOut?.diagnostics[0]?.code).toBe("GATE_EVALUATION");
    vi.useRealTimers();
  });
});

describe("runPhase", () => {
  it("takes one pre-deployment snapshot before evaluating gates", async () => {
    const sample = vi.fn(async () => true);
    const execute = vi.fn(async (item: PlannedGate) => result(item));
    const phasePlan: ExecutionPlan = {
      phase: "pre_deployment",
      targetId: "production",
      runtimeType: "kubernetes",
      gates: [gate(0)],
      requiredProviders: [],
      deadlineMs: 1_000
    };

    await runPhase({
      plan: phasePlan,
      observation: {
        warmupMs: 0,
        sampleIntervalMs: 10,
        minimumSuccessfulSamples: 1,
        maximumExtensionMs: 0
      },
      signal: new AbortController().signal,
      sample,
      executeGate: execute
    });

    expect(sample).toHaveBeenCalledOnce();
    expect(sample.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("waits for warmup and the minimum successful post-deployment samples", async () => {
    let now = 0;
    const waits: number[] = [];
    const outcomes = [false, true, true];
    const sample = vi.fn(async () => outcomes.shift() ?? false);
    const phasePlan: ExecutionPlan = {
      phase: "post_deployment",
      targetId: "production",
      runtimeType: "kubernetes",
      gates: [gate(0)],
      requiredProviders: [],
      deadlineMs: 1_000
    };

    const results = await runPhase({
      plan: phasePlan,
      observation: {
        warmupMs: 100,
        evaluationWindowMs: 200,
        sampleIntervalMs: 25,
        minimumSuccessfulSamples: 2,
        maximumExtensionMs: 100
      },
      signal: new AbortController().signal,
      sample,
      clock: () => new Date(now),
      wait: async (ms) => {
        waits.push(ms);
        now += ms;
      },
      executeGate: async (item) => result(item)
    });

    expect(waits).toEqual([100, 25, 25]);
    expect(sample).toHaveBeenCalledTimes(3);
    expect(results[0]?.status).toBe("passed");
  });

  it("classifies low traffic after the bounded maximum extension", async () => {
    let now = 0;
    const phasePlan: ExecutionPlan = {
      phase: "post_deployment",
      targetId: "production",
      runtimeType: "kubernetes",
      gates: [gate(0)],
      requiredProviders: [],
      deadlineMs: 1_000
    };
    const execute = vi.fn(async (item: PlannedGate) => result(item));

    const results = await runPhase({
      plan: phasePlan,
      observation: {
        warmupMs: 0,
        evaluationWindowMs: 50,
        sampleIntervalMs: 25,
        minimumSuccessfulSamples: 2,
        maximumExtensionMs: 25
      },
      signal: new AbortController().signal,
      sample: async () => false,
      clock: () => new Date(now),
      wait: async (ms) => {
        now += ms;
      },
      executeGate: execute
    });

    expect(execute).not.toHaveBeenCalled();
    expect(results[0]?.status).toBe("inconclusive");
    expect(now).toBe(100);
  });
});
