import { describe, expect, it, vi } from "vitest";
import {
  ObservabilityGateService,
  type ApplicationPolicyAdapter,
  type ExecutionPlan,
  type ExecutionRequest,
  type GateResult,
  type PlannedGate,
  type ProviderSession
} from "../../src/index.js";

interface Policy {
  readonly valid: boolean;
}

const plannedGate: PlannedGate = Object.freeze({
  index: 0,
  id: "readiness",
  name: "Readiness",
  type: "test.readiness",
  enforcement: "blocking",
  applicability: "applicable",
  timeoutMs: 1_000,
  providerRequirements: Object.freeze([
    Object.freeze({ provider: "metrics", capability: "query", required: true })
  ]),
  definition: Object.freeze({})
});

const plan: ExecutionPlan = Object.freeze({
  phase: "pre_deployment",
  targetId: "production",
  runtimeType: "kubernetes",
  gates: Object.freeze([plannedGate]),
  requiredProviders: Object.freeze(plannedGate.providerRequirements),
  deadlineMs: 10_000
});

function request(signal = new AbortController().signal): ExecutionRequest {
  return {
    workspaceRoot: "/workspace",
    configPath: "observability-gate.yml",
    phase: "pre_deployment",
    environment: {},
    cancellationSignal: signal
  };
}

function passingResult(): GateResult {
  return {
    id: plannedGate.id,
    name: plannedGate.name,
    type: plannedGate.type,
    phase: "pre_deployment",
    enforcement: "blocking",
    status: "passed",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 0,
    assertions: [],
    evidence: [],
    diagnostics: []
  };
}

function adapter(events: string[]): ApplicationPolicyAdapter<Policy> {
  return {
    async load() {
      events.push("load");
      return { valid: true };
    },
    interpolate(policy) {
      events.push("interpolate");
      return policy;
    },
    createPlan() {
      events.push("validate-and-plan");
      return plan;
    },
    describeExecution() {
      return {
        target: { id: "production", runtimeType: "kubernetes", provider: "runtime" },
        release: { candidateId: "release-1", deploymentId: "deployment-1" },
        decisionPolicy: { minimumEvidenceCoveragePercent: 0, warnOnSkipped: false },
        missingEvidenceBehavior: { blocking: "fail", advisory: "warn" },
        observation: {
          warmupMs: 0,
          sampleIntervalMs: 0,
          minimumSuccessfulSamples: 1,
          maximumExtensionMs: 0
        },
        links: {}
      };
    }
  };
}

describe("ObservabilityGateService", () => {
  it("orchestrates load, interpolation, planning, providers, gates, aggregation, then reporting", async () => {
    const events: string[] = [];
    const providers = {
      async initialize(): Promise<ProviderSession> {
        events.push("providers");
        return { close: async () => events.push("close") };
      }
    };
    const service = new ObservabilityGateService({
      policy: adapter(events),
      providers,
      async executeGate() {
        events.push("gate");
        return passingResult();
      },
      reporters: [async () => events.push("report")]
    });

    const result = await service.run(request());

    expect(result.decision).toBe("pass");
    expect(events).toEqual([
      "load",
      "interpolate",
      "validate-and-plan",
      "providers",
      "gate",
      "report",
      "close"
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.gates)).toBe(true);
  });

  it("validates and plans without initializing providers", async () => {
    const events: string[] = [];
    const initialize = vi.fn();
    const service = new ObservabilityGateService({
      policy: adapter(events),
      providers: { initialize },
      executeGate: async () => passingResult()
    });

    expect(await service.validate(request())).toEqual([]);
    expect((await service.plan(request())).targetId).toBe("production");
    expect(initialize).not.toHaveBeenCalled();
  });

  it("returns diagnostics and performs zero provider calls for invalid configuration", async () => {
    const initialize = vi.fn();
    const broken = adapter([]);
    const service = new ObservabilityGateService({
      policy: {
        ...broken,
        createPlan() {
          throw new Error("invalid configuration");
        }
      },
      providers: { initialize },
      executeGate: async () => passingResult()
    });

    const diagnostics = await service.validate(request());
    expect(diagnostics[0]?.code).toBe("INTERNAL");
    expect(initialize).not.toHaveBeenCalled();
  });

  it("turns cancellation during reporting into an error decision", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const service = new ObservabilityGateService({
      policy: adapter([]),
      providers: {
        async initialize() {
          return {};
        }
      },
      executeGate: async () => passingResult(),
      reporters: [
        async (_result, signal) => {
          await new Promise<void>((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
      ]
    });

    const running = service.run(request(controller.signal));
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1);
    const result = await running;

    expect(result.decision).toBe("error");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CANCELLED")).toBe(true);
    vi.useRealTimers();
  });
});
