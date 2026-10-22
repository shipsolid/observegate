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
        phase: "pre_deployment",
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
  it("emits safe execution milestones and retains provider acquisition timings", async () => {
    const seen: string[] = [];
    const service = new ObservabilityGateService({
      policy: adapter([]),
      providers: {
        initialize: async () => ({
          timings: () => [{ provider: "metrics", calls: 1, durationMs: 12 }]
        })
      },
      executeGate: async () => passingResult()
    });
    const result = await service.run({ ...request(), onEvent: (event) => seen.push(event.name) });
    expect(seen).toEqual([
      "configuration_loaded",
      "execution_planned",
      "gate_completed",
      "decision_completed"
    ]);
    expect(result.providerTimings).toEqual([{ provider: "metrics", calls: 1, durationMs: 12 }]);
  });
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
      "close",
      "report"
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.gates)).toBe(true);
  });

  it.each([
    { state: "stale", capability: "query", target: "production", releaseId: "release-1" },
    {
      state: "valid",
      capability: "wrong-capability",
      target: "production",
      releaseId: "release-1"
    },
    { state: "valid", capability: "query", target: "wrong-target", releaseId: "release-1" },
    { state: "valid", capability: "query", target: "production", releaseId: "wrong-release" },
    {
      state: "valid",
      capability: "query",
      target: "production",
      releaseId: "release-1",
      expiresAt: "2000-01-01T00:00:00Z"
    }
  ] as const)(
    "does not count invalid requirement evidence toward coverage: %j",
    async (metadata) => {
      const policy = adapter([]);
      const service = new ObservabilityGateService({
        policy: {
          ...policy,
          describeExecution(...args) {
            const execution = policy.describeExecution(...args);
            return {
              ...execution,
              decisionPolicy: { ...execution.decisionPolicy, minimumEvidenceCoveragePercent: 100 }
            };
          }
        },
        providers: {
          async initialize() {
            return {};
          }
        },
        async executeGate() {
          return {
            ...passingResult(),
            evidence: [
              {
                id: "e",
                kind: "metric",
                provider: "metrics",
                acquiredAt: "2026-01-01T00:00:00Z",
                fingerprint: "e",
                ...metadata
              }
            ]
          };
        }
      });
      const result = await service.run(request());
      expect(result.evidenceCoveragePercent).toBe(0);
      expect(result.decision).toBe("fail");
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "EVIDENCE_INVALID",
          gateId: "evidence-coverage",
          message: "Evidence coverage 0% is below the required 100%."
        })
      );
    }
  );

  it("counts valid capabilities separately for a matching workload", async () => {
    const policy = adapter([]);
    const service = new ObservabilityGateService({
      policy: {
        ...policy,
        createPlan() {
          return {
            ...plan,
            gates: [
              {
                ...plannedGate,
                providerRequirements: [
                  ...plannedGate.providerRequirements,
                  { provider: "metrics", capability: "range", required: true }
                ]
              }
            ]
          };
        }
      },
      providers: {
        async initialize() {
          return {};
        }
      },
      async executeGate() {
        return {
          ...passingResult(),
          evidence: [
            {
              id: "e",
              kind: "metric",
              provider: "metrics",
              state: "valid",
              capability: "query",
              target: "production",
              releaseId: "release-1",
              acquiredAt: "2026-01-01T00:00:00Z",
              fingerprint: "e"
            }
          ]
        };
      }
    });
    expect((await service.run(request())).evidenceCoveragePercent).toBe(50);
  });

  it("contains throwing cleanup and reports its structured failure", async () => {
    const published: unknown[] = [];
    const service = new ObservabilityGateService({
      policy: adapter([]),
      providers: {
        async initialize() {
          return {
            async close() {
              throw new Error("Bearer secret-value");
            }
          };
        }
      },
      executeGate: async () => passingResult(),
      reporters: [
        async (result) => {
          published.push(result.decision);
        }
      ]
    });
    const result = await service.run(request());
    expect(result.decision).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(published).toEqual(["error"]);
  });

  it("bounds uncooperative initialization and cleanup", async () => {
    vi.useFakeTimers();
    try {
      for (const stage of ["initialize", "close"] as const) {
        const policy = adapter([]);
        const service = new ObservabilityGateService({
          policy: {
            ...policy,
            createPlan() {
              return { ...plan, providerInitializationTimeoutMs: 5, providerCleanupTimeoutMs: 5 };
            }
          },
          providers: {
            async initialize() {
              if (stage === "initialize") return new Promise(() => undefined);
              return {
                async close() {
                  return new Promise<void>(() => undefined);
                }
              };
            }
          },
          executeGate: async () => passingResult()
        });
        const running = service.run(request());
        await vi.advanceTimersByTimeAsync(10);
        const result = await running;
        expect(result.decision).toBe("error");
        expect(result.diagnostics.length).toBeGreaterThan(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps provider lifecycle cancellation connected after initialization", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const service = new ObservabilityGateService({
      policy: adapter([]),
      providers: {
        async initialize(_requirements, context) {
          providerSignal = context.signal;
          return {};
        }
      },
      async executeGate() {
        controller.abort();
        return passingResult();
      }
    });
    await service.run(request(controller.signal));
    expect(providerSignal?.aborted).toBe(true);
  });

  it("keeps an existing failed decision and evidence when cleanup fails", async () => {
    const failed = { ...passingResult(), status: "failed" as const };
    const service = new ObservabilityGateService({
      policy: adapter([]),
      providers: {
        async initialize() {
          return {
            async close() {
              throw new Error("cleanup");
            }
          };
        }
      },
      executeGate: async () => failed
    });
    const result = await service.run(request());
    expect(result.decision).toBe("fail");
    expect(result.gates).toEqual([failed]);
    expect(result.diagnostics[0]?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("does not initialize providers after the total runtime budget is spent in preparation", async () => {
    let now = 0;
    const initialize = vi.fn(async () => ({}));
    const policy = adapter([]);
    const service = new ObservabilityGateService({
      policy: {
        ...policy,
        createPlan() {
          now = 10;
          return { ...plan, maximumTotalRuntimeMs: 5 };
        }
      },
      providers: { initialize },
      executeGate: async () => passingResult(),
      clock: () => new Date(now)
    });
    const result = await service.run(request());
    expect(result.decision).toBe("error");
    expect(initialize).not.toHaveBeenCalled();
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
