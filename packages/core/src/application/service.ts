import { aggregateDecision, type DecisionPolicy } from "../decisions/aggregate.js";
import type { EvidenceRequirementCoverage } from "../decisions/coverage.js";
import type { ExecutionRequest, ExecutionResult } from "../domain/execution.js";
import type { Diagnostic, GateResult } from "../domain/gates.js";
import type { ReleaseIdentity, TargetIdentity } from "../domain/identity.js";
import type { ExecutionPlan, ProviderRequirement } from "../domain/planning.js";
import { GateError } from "../errors/gate-error.js";
import { abortPromise, cancellationError } from "../execution/deadline.js";
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
  };
  readonly observation: ObservationSchedule;
  readonly links: Readonly<Record<string, string>>;
  readonly configurationFingerprint?: string;
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
  readonly sample?: (signal: AbortSignal) => Promise<boolean>;
  readonly close?: () => Promise<void>;
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
  gates: readonly GateResult[]
): readonly EvidenceRequirementCoverage[] {
  const results = new Map(gates.map((gate) => [gate.id, gate]));
  return Object.freeze(
    plan.gates.flatMap((gate) =>
      gate.providerRequirements.map((requirement) =>
        Object.freeze({
          gateId: gate.id,
          requirementId: `${requirement.provider}:${requirement.capability}`,
          satisfied:
            results
              .get(gate.id)
              ?.evidence.some((evidence) => evidence.provider === requirement.provider) === true
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
    let providers: ProviderSession | undefined;
    try {
      if (request.cancellationSignal.aborted) throw cancellationError();
      providers = await Promise.race([
        this.dependencies.providers.initialize(prepared.plan.requiredProviders, {
          policy: prepared.policy,
          plan: prepared.plan,
          request,
          signal: request.cancellationSignal
        }),
        abortPromise(request.cancellationSignal)
      ]);

      const gates = await runPhase({
        plan: prepared.plan,
        observation: prepared.execution.observation,
        signal: request.cancellationSignal,
        clock: this.clock,
        ...(providers.sample === undefined ? {} : { sample: providers.sample }),
        executeGate: (gate, context) =>
          this.dependencies.executeGate(
            gate,
            { ...context, execution: prepared.execution },
            providers as ProviderSession
          )
      });
      const summary = aggregateDecision({
        gates,
        configurationOrder: prepared.plan.gates.map((gate) => gate.id),
        policy: prepared.execution.decisionPolicy,
        evidenceRequirements: coverageRequirements(prepared.plan, gates)
      });
      let result = freezeResult({
        decision: summary.decision,
        phase: request.phase,
        target: prepared.execution.target,
        release: prepared.execution.release,
        startedAt: startedAt.toISOString(),
        completedAt: this.clock().toISOString(),
        evidenceCoveragePercent: summary.evidenceCoveragePercent,
        ...(prepared.execution.configurationFingerprint === undefined
          ? {}
          : { configurationFingerprint: prepared.execution.configurationFingerprint }),
        gates: summary.gates,
        diagnostics: Object.freeze([]),
        links: prepared.execution.links
      });

      try {
        for (const reporter of this.dependencies.reporters ?? []) {
          await Promise.race([
            reporter(result, request.cancellationSignal),
            abortPromise(request.cancellationSignal)
          ]);
        }
      } catch (error) {
        const reportDiagnostic = request.cancellationSignal.aborted
          ? diagnostic(cancellationError("Reporting was cancelled."))
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
        result = freezeResult({
          ...result,
          decision: result.decision === "fail" ? "fail" : "error",
          completedAt: this.clock().toISOString(),
          diagnostics: Object.freeze([...result.diagnostics, reportDiagnostic])
        });
      }
      return result;
    } catch (error) {
      return failedExecution(
        request,
        startedAt,
        this.clock(),
        request.cancellationSignal.aborted ? cancellationError() : error,
        identity,
        [],
        prepared.execution.links
      );
    } finally {
      await providers?.close?.();
    }
  }

  private async prepare(request: ExecutionRequest): Promise<{
    readonly policy: TPolicy;
    readonly plan: ExecutionPlan;
    readonly execution: PreparedExecution;
  }> {
    const loaded = await this.dependencies.policy.load(request);
    const policy = this.dependencies.policy.interpolate(loaded, request);
    const plan = this.dependencies.policy.createPlan(policy, request);
    const execution = this.dependencies.policy.describeExecution(policy, plan, request);
    return { policy, plan, execution };
  }
}
