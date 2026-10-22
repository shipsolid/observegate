import { aggregateDecision, type DecisionPolicy } from "../decisions/aggregate.js";
import type { EvidenceRequirementCoverage } from "../decisions/coverage.js";
import type { ExecutionRequest, ExecutionResult, ProviderTiming } from "../domain/execution.js";
import type { Diagnostic, GateResult } from "../domain/gates.js";
import type { ReleaseIdentity, TargetIdentity } from "../domain/identity.js";
import type { ExecutionPlan, ProviderRequirement } from "../domain/planning.js";
import type { Evidence } from "../evidence/types.js";
import type { EvidenceStore } from "../evidence/store.js";
import { GateError } from "../errors/gate-error.js";
import { raceWithSignal, createDeadline } from "../execution/deadline.js";
import type { GateRunContext } from "./run-gate.js";
import { runPhase, type ObservationSchedule } from "./run-phase.js";

export interface PreparedExecution {
  readonly phase: ExecutionRequest["phase"];
  readonly target: TargetIdentity;
  readonly release: ReleaseIdentity;
  readonly decisionPolicy: DecisionPolicy;
  readonly missingEvidenceBehavior: {
    readonly blocking: "fail" | "warn" | "inconclusive";
    readonly advisory: "fail" | "warn" | "inconclusive";
    readonly comparison?: "fail" | "warn" | "inconclusive";
    readonly synthetic?: "fail" | "warn" | "inconclusive";
  };
  readonly observation: ObservationSchedule;
  readonly links: Readonly<Record<string, string>>;
  readonly configurationFingerprint?: string;
  readonly artifactRetentionDays?: number;
}

export interface ApplicationPolicyAdapter<TPolicy> {
  readonly load: (request: ExecutionRequest) => Promise<TPolicy>;
  readonly interpolate: (policy: TPolicy, request: ExecutionRequest) => TPolicy;
  readonly createPlan: (policy: TPolicy, request: ExecutionRequest) => ExecutionPlan;
  readonly describeExecution: (
    policy: TPolicy,
    plan: ExecutionPlan,
    request: ExecutionRequest
  ) => PreparedExecution;
}

export interface ProviderSession {
  readonly timings?: () => readonly ProviderTiming[];
  readonly sample?: (signal: AbortSignal) => Promise<boolean>;
  readonly resolveEvidence?: (
    gateType: string,
    definition: Readonly<Record<string, unknown>>,
    context: {
      readonly phase: ExecutionRequest["phase"];
      readonly targetId: string;
      readonly releaseId?: string;
      readonly evidenceStore: EvidenceStore;
      readonly signal: AbortSignal;
      readonly clock: () => Date;
    }
  ) => Promise<readonly Evidence<unknown>[]>;
  readonly close?: (signal?: AbortSignal) => Promise<void>;
}

export interface ProviderFactory<TPolicy> {
  readonly initialize: (
    requirements: readonly ProviderRequirement[],
    context: {
      readonly policy: TPolicy;
      readonly plan: ExecutionPlan;
      readonly request: ExecutionRequest;
      readonly signal: AbortSignal;
    }
  ) => Promise<ProviderSession>;
}

export type ApplicationGateExecutor = (
  gate: ExecutionPlan["gates"][number],
  context: GateRunContext & { readonly execution: PreparedExecution },
  providers: ProviderSession
) => Promise<GateResult>;

export type ExecutionReporter = (result: ExecutionResult, signal: AbortSignal) => Promise<void>;

export interface ObservabilityGateServiceDependencies<TPolicy> {
  readonly policy: ApplicationPolicyAdapter<TPolicy>;
  readonly providers: ProviderFactory<TPolicy>;
  readonly executeGate: ApplicationGateExecutor;
  readonly reporters?: readonly ExecutionReporter[];
  readonly clock?: () => Date;
}

function diagnostic(error: unknown): Diagnostic {
  if (error instanceof GateError) return error.toDiagnostic();
  return Object.freeze({
    code: "INTERNAL",
    message: "Execution failed unexpectedly.",
    retryable: false
  });
}

function freezeResult(result: ExecutionResult): ExecutionResult {
  return Object.freeze({
    ...result,
    target: Object.freeze({ ...result.target }),
    release: Object.freeze({ ...result.release }),
    gates: Object.freeze([...result.gates]),
    diagnostics: Object.freeze([...result.diagnostics]),
    links: Object.freeze({ ...result.links })
  });
}

function placeholderIdentity(request: ExecutionRequest): {
  readonly target: TargetIdentity;
  readonly release: ReleaseIdentity;
} {
  return {
    target: Object.freeze({
      id: request.targetOverride ?? "unresolved",
      runtimeType: "unresolved",
      provider: "unresolved"
    }),
    release: Object.freeze({
      candidateId: request.environment.RELEASE_ID ?? "unresolved",
      deploymentId: request.environment.DEPLOYMENT_ID ?? "unresolved"
    })
  };
}

function failedExecution(
  request: ExecutionRequest,
  startedAt: Date,
  completedAt: Date,
  error: unknown,
  identity = placeholderIdentity(request),
  gates: readonly GateResult[] = [],
  links: Readonly<Record<string, string>> = {}
): ExecutionResult {
  return freezeResult({
    decision: "error",
    phase: request.phase,
    target: identity.target,
    release: identity.release,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    evidenceCoveragePercent: 0,
    gates,
    diagnostics: Object.freeze([diagnostic(error)]),
    links
  });
}

function coverageRequirements(
  plan: ExecutionPlan,
  gates: readonly GateResult[],
  execution: PreparedExecution,
  now: Date
): readonly EvidenceRequirementCoverage[] {
  const results = new Map(gates.map((gate) => [gate.id, gate]));
  return Object.freeze(
    plan.gates.flatMap((gate) =>
      gate.providerRequirements
        .filter((requirement) => requirement.required)
        .map((requirement) =>
          Object.freeze({
            gateId: gate.id,
            requirementId: `${requirement.provider}:${requirement.capability}`,
            satisfied:
              results
                .get(gate.id)
                ?.evidence.some(
                  (evidence) =>
                    evidence.provider === requirement.provider &&
                    evidence.capability === requirement.capability &&
                    evidence.state === "valid" &&
                    evidence.target === execution.target.id &&
                    (evidence.releaseId === undefined ||
                      evidence.releaseId === execution.release.candidateId) &&
                    Number.isFinite(Date.parse(evidence.acquiredAt)) &&
                    (evidence.expiresAt === undefined ||
                      Date.parse(evidence.expiresAt) >= now.getTime())
                ) === true
          })
        )
    )
  );
}

export class ObservabilityGateService<TPolicy> {
  private readonly clock: () => Date;

  public constructor(private readonly dependencies: ObservabilityGateServiceDependencies<TPolicy>) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  public async validate(request: ExecutionRequest): Promise<readonly Diagnostic[]> {
    try {
      await this.prepare(request);
      return Object.freeze([]);
    } catch (error) {
      return Object.freeze([diagnostic(error)]);
    }
  }

  public async plan(request: ExecutionRequest): Promise<ExecutionPlan> {
    return (await this.prepare(request)).plan;
  }

  public async run(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = this.clock();
    let prepared: Awaited<ReturnType<ObservabilityGateService<TPolicy>["prepare"]>>;
    try {
      prepared = await this.prepare(request);
    } catch (error) {
      return failedExecution(request, startedAt, this.clock(), error);
    }

    const identity = { target: prepared.execution.target, release: prepared.execution.release };
    const budgetMs = Math.min(
      prepared.plan.deadlineMs,
      prepared.plan.maximumTotalRuntimeMs ?? prepared.plan.deadlineMs
    );
    const elapsedMs = Math.max(0, this.clock().getTime() - startedAt.getTime());
    const deadline = createDeadline(request.cancellationSignal, Math.max(0, budgetMs - elapsedMs));
    let providers: ProviderSession | undefined;
    let initialization: ReturnType<typeof createDeadline> | undefined;
    let result: ExecutionResult;
    try {
      if (deadline.signal.aborted) throw deadline.signal.reason;
      if (elapsedMs >= budgetMs)
        throw new GateError({
          code: "GATE_EVALUATION",
          safeMessage: "Execution exceeded its total runtime budget.",
          retryable: false
        });
      initialization = createDeadline(
        deadline.signal,
        prepared.plan.providerInitializationTimeoutMs ?? Math.min(budgetMs, 30_000),
        {
          code: "PROVIDER_UNAVAILABLE",
          message: "Provider initialization exceeded its deadline."
        }
      );
      let accepted = false;
      try {
        const pending = this.dependencies.providers.initialize(prepared.plan.requiredProviders, {
          policy: prepared.policy,
          plan: prepared.plan,
          request,
          signal: initialization.signal
        });
        // An uncooperative factory may resolve after its deadline. Dispose that late session too.
        void pending
          .then(async (session) => {
            if (!accepted && initialization?.signal.aborted) {
              await this.closeProviders(session, prepared.plan.providerCleanupTimeoutMs ?? 5_000);
            }
          })
          .catch(() => undefined);
        providers = await raceWithSignal(pending, initialization.signal);
        accepted = true;
      } finally {
        initialization.stopTimer();
      }
      const gates = await runPhase({
        plan: prepared.plan,
        observation: prepared.execution.observation,
        signal: deadline.signal,
        clock: this.clock,
        ...(providers.sample === undefined ? {} : { sample: providers.sample }),
        executeGate: async (gate, context) => {
          const completed = await this.dependencies.executeGate(
            gate,
            { ...context, execution: prepared.execution },
            providers as ProviderSession
          );
          request.onEvent?.({
            name: "gate_completed",
            at: this.clock().toISOString(),
            phase: request.phase,
            gateId: gate.id,
            status: completed.status,
            durationMs: completed.durationMs
          });
          return completed;
        }
      });
      const summary = aggregateDecision({
        gates,
        configurationOrder: prepared.plan.gates.map((gate) => gate.id),
        policy: prepared.execution.decisionPolicy,
        evidenceRequirements: coverageRequirements(
          prepared.plan,
          gates,
          prepared.execution,
          this.clock()
        )
      });
      result = freezeResult({
        decision: summary.decision,
        phase: request.phase,
        target: prepared.execution.target,
        release: prepared.execution.release,
        startedAt: startedAt.toISOString(),
        completedAt: this.clock().toISOString(),
        evidenceCoveragePercent: summary.evidenceCoveragePercent,
        ...(providers.timings === undefined ? {} : { providerTimings: providers.timings() }),
        ...(prepared.execution.artifactRetentionDays === undefined
          ? {}
          : { artifactRetentionDays: prepared.execution.artifactRetentionDays }),
        ...(prepared.execution.configurationFingerprint === undefined
          ? {}
          : { configurationFingerprint: prepared.execution.configurationFingerprint }),
        gates: summary.gates,
        diagnostics: Object.freeze(
          summary.blockingReasons
            .filter((reason) => reason.gateId === "evidence-coverage")
            .map((reason) => ({
              code: "EVIDENCE_INVALID",
              message: reason.message,
              retryable: false,
              gateId: reason.gateId
            }))
        ),
        links: prepared.execution.links
      });
    } catch (error) {
      result = failedExecution(
        request,
        startedAt,
        this.clock(),
        deadline.signal.aborted ? deadline.signal.reason : error,
        identity,
        [],
        prepared.execution.links
      );
    }

    if (providers !== undefined) {
      const remaining = Math.max(0, budgetMs - (this.clock().getTime() - startedAt.getTime()));
      const closeDiagnostic = await this.closeProviders(
        providers,
        Math.min(prepared.plan.providerCleanupTimeoutMs ?? 5_000, remaining),
        deadline.signal
      );
      if (closeDiagnostic !== undefined) result = this.addFailure(result, closeDiagnostic);
    }
    try {
      if (deadline.signal.aborted) throw deadline.signal.reason;
      for (const reporter of this.dependencies.reporters ?? []) {
        await raceWithSignal(reporter(result, deadline.signal), deadline.signal);
      }
      if (deadline.signal.aborted) throw deadline.signal.reason;
    } catch (error) {
      const failure = deadline.signal.aborted
        ? diagnostic(deadline.signal.reason)
        : diagnostic(
            error instanceof GateError
              ? error
              : new GateError({
                  code: "REPORTING",
                  safeMessage: "Report publication failed.",
                  retryable: false,
                  cause: error
                })
          );
      result = this.addFailure(result, failure);
    } finally {
      initialization?.dispose();
      deadline.dispose();
    }
    request.onEvent?.({
      name: "decision_completed",
      at: this.clock().toISOString(),
      phase: request.phase,
      decision: result.decision
    });
    return result;
  }

  private addFailure(result: ExecutionResult, failure: Diagnostic): ExecutionResult {
    return freezeResult({
      ...result,
      decision: result.decision === "fail" ? "fail" : "error",
      completedAt: this.clock().toISOString(),
      diagnostics: [...result.diagnostics, failure]
    });
  }

  private async closeProviders(
    providers: ProviderSession,
    timeoutMs: number,
    parent = new AbortController().signal
  ): Promise<Diagnostic | undefined> {
    if (providers.close === undefined) return undefined;
    const cleanup = createDeadline(parent, timeoutMs, {
      code: "PROVIDER_UNAVAILABLE",
      message: "Provider cleanup exceeded its deadline."
    });
    try {
      await raceWithSignal(providers.close(cleanup.signal), cleanup.signal);
      if (cleanup.signal.aborted) throw cleanup.signal.reason;
      return undefined;
    } catch (error) {
      return diagnostic(
        error instanceof GateError
          ? error
          : new GateError({
              code: "PROVIDER_UNAVAILABLE",
              safeMessage: "Provider cleanup failed.",
              retryable: false,
              cause: error
            })
      );
    } finally {
      cleanup.dispose();
    }
  }

  private async prepare(request: ExecutionRequest): Promise<{
    readonly policy: TPolicy;
    readonly plan: ExecutionPlan;
    readonly execution: PreparedExecution;
  }> {
    const loaded = await this.dependencies.policy.load(request);
    request.onEvent?.({
      name: "configuration_loaded",
      at: this.clock().toISOString(),
      phase: request.phase
    });
    const policy = this.dependencies.policy.interpolate(loaded, request);
    const plan = this.dependencies.policy.createPlan(policy, request);
    const execution = this.dependencies.policy.describeExecution(policy, plan, request);
    request.onEvent?.({
      name: "execution_planned",
      at: this.clock().toISOString(),
      phase: request.phase
    });
    return { policy, plan, execution };
  }
}
