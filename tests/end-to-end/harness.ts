import {
  ObservabilityGateService,
  stableFingerprint,
  type Evidence,
  type EvidenceState,
  type ExecutionPlan,
  type ExecutionResult,
  type Phase,
  type PlannedGate
} from "@observability-gate/core";
import { createBuiltInGateCatalog, executeGate } from "@observability-gate/gates";

export interface GateScenario {
  readonly id: string;
  readonly type: string;
  readonly phase: Phase;
  readonly value?: unknown;
  readonly state?: EvidenceState;
  readonly enforcement?: "blocking" | "advisory";
  readonly definition?: Readonly<Record<string, unknown>>;
  readonly missingEvidenceBehavior?: "fail" | "warn" | "inconclusive";
  readonly signal?: AbortSignal;
}

export async function runGateScenario(scenario: GateScenario): Promise<ExecutionResult> {
  const catalog = createBuiltInGateCatalog();
  const metadata = catalog.metadata()[scenario.type];
  if (metadata === undefined) throw new Error(`Unknown test gate type: ${scenario.type}`);
  const gate: PlannedGate = Object.freeze({
    index: 0,
    id: scenario.id,
    name: scenario.id,
    type: scenario.type,
    enforcement: scenario.enforcement ?? "blocking",
    applicability: "applicable",
    timeoutMs: 2_000,
    providerRequirements: metadata.providerRequirements,
    definition: Object.freeze({
      id: scenario.id,
      name: scenario.id,
      type: scenario.type,
      ...(scenario.definition ?? {})
    })
  });
  const plan: ExecutionPlan = Object.freeze({
    phase: scenario.phase,
    targetId: "checkout-production",
    runtimeType: "kubernetes",
    gates: Object.freeze([gate]),
    requiredProviders: metadata.providerRequirements,
    deadlineMs: 5_000,
    concurrency: 1,
    perProviderConcurrency: 1,
    failFast: false
  });
  const service = new ObservabilityGateService({
    policy: {
      async load() {
        return Object.freeze({ scenario });
      },
      interpolate(policy) {
        return policy;
      },
      createPlan() {
        return plan;
      },
      describeExecution() {
        return {
          phase: scenario.phase,
          target: {
            id: "checkout-production",
            runtimeType: "kubernetes",
            provider: "scenario"
          },
          release: { candidateId: "release-candidate", deploymentId: "deployment-1" },
          decisionPolicy: { minimumEvidenceCoveragePercent: 0, warnOnSkipped: false },
          missingEvidenceBehavior: {
            blocking: scenario.missingEvidenceBehavior ?? "fail",
            advisory: "warn" as const
          },
          observation: {
            warmupMs: 0,
            evaluationWindowMs: 0,
            sampleIntervalMs: 0,
            minimumSuccessfulSamples: 1,
            maximumExtensionMs: 0
          },
          links: {},
          configurationFingerprint: stableFingerprint(scenario.definition ?? {})
        };
      }
    },
    providers: {
      async initialize() {
        return {
          async resolveEvidence(gateType, _definition, context) {
            const acquiredAt = "2026-10-06T00:00:00.000Z";
            const evidence: Evidence<unknown> = Object.freeze({
              id: stableFingerprint({ gateType, id: scenario.id, value: scenario.value }),
              kind: gateType,
              state: scenario.state ?? "valid",
              source: Object.freeze({
                provider: metadata.providerRequirements[0]?.provider ?? "scenario",
                capability: gateType
              }),
              target: context.targetId,
              releaseId: context.releaseId,
              acquiredAt,
              ...(scenario.value === undefined ? {} : { value: scenario.value }),
              diagnostics: Object.freeze([])
            });
            return Object.freeze([evidence]);
          }
        };
      }
    },
    executeGate: (planned, context, providers) =>
      executeGate(planned, catalog, {
        phase: scenario.phase,
        targetId: context.execution.target.id,
        releaseId: context.execution.release.candidateId,
        evidenceStore: context.evidenceStore,
        signal: context.signal,
        clock: () => new Date("2026-10-06T00:00:00.000Z"),
        ...(providers.resolveEvidence === undefined
          ? {}
          : { resolveEvidence: providers.resolveEvidence }),
        missingEvidenceBehavior: context.execution.missingEvidenceBehavior
      })
  });

  return service.run({
    workspaceRoot: process.cwd(),
    configPath: "scenario.yml",
    phase: scenario.phase,
    environment: {},
    cancellationSignal: scenario.signal ?? new AbortController().signal
  });
}
