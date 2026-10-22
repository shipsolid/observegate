import {
  GateError,
  ObservabilityGateService,
  parseByteSize,
  type ExecutionRequest
} from "@observability-gate/core";
import {
  createExecutionPlan,
  describePolicyExecution,
  interpolatePolicy,
  loadPolicy,
  githubReportingOptions,
  publicationOptions,
  type RawPolicy
} from "@observability-gate/config";
import {
  createBuiltInGateCatalog,
  executeGate as executeCatalogGate
} from "@observability-gate/gates";
import {
  bindAcquisitionPlan,
  createPolicyProviderSession,
  validateProviderAcquisition
} from "@observability-gate/providers/session";

export function createActionService() {
  const catalog = createBuiltInGateCatalog();
  const service = new ObservabilityGateService<RawPolicy>({
    policy: {
      load: (request) => loadPolicy(request.configPath, request.workspaceRoot),
      interpolate: (policy, request) =>
        interpolatePolicy(policy, {
          phase: request.phase,
          environment: request.environment,
          ...(request.targetOverride === undefined
            ? {}
            : { targetOverride: request.targetOverride })
        }),
      createPlan(policy, request) {
        const plan = createExecutionPlan({
          policy,
          phase: request.phase,
          catalog: catalog.metadata()
        });
        const scoped = {
          ...policy,
          gates: {
            ...policy.gates,
            [request.phase]: plan.gates
              .filter((gate) => gate.applicability === "applicable")
              .map((gate) => gate.definition)
          }
        };
        const errors = validateProviderAcquisition(scoped, request.phase);
        if (errors.length > 0)
          throw new GateError({
            code: "CONFIG_REFERENCE",
            safeMessage: errors.join("; "),
            retryable: false
          });
        return bindAcquisitionPlan(policy, plan);
      },
      describeExecution: describePolicyExecution
    },
    providers: {
      async initialize(_requirements, context) {
        return createPolicyProviderSession({
          policy: context.policy,
          plan: context.plan,
          workspaceRoot: context.request.workspaceRoot,
          environment: context.request.environment
        });
      }
    },
    executeGate: (gate, context, providers) =>
      executeCatalogGate(gate, catalog, {
        phase: context.execution.phase,
        targetId: context.execution.target.id,
        releaseId: context.execution.release.candidateId,
        ...(context.execution.release.baselineId === undefined
          ? {}
          : { baselineReleaseId: context.execution.release.baselineId }),
        evidenceStore: context.evidenceStore,
        signal: context.signal,
        clock: () => new Date(),
        ...(providers.resolveEvidence === undefined
          ? {}
          : { resolveEvidence: providers.resolveEvidence }),
        missingEvidenceBehavior: context.execution.missingEvidenceBehavior
      })
  });
  return {
    run: (request: ExecutionRequest) => service.run(request),
    async publicationOptions(request: ExecutionRequest) {
      const policy = interpolatePolicy(
        await loadPolicy(request.configPath, request.workspaceRoot),
        {
          phase: request.phase,
          environment: request.environment,
          ...(request.targetOverride === undefined
            ? {}
            : { targetOverride: request.targetOverride })
        }
      );
      return publicationOptions(policy);
    },
    async reportingOptions(request: ExecutionRequest) {
      return githubReportingOptions(await loadPolicy(request.configPath, request.workspaceRoot));
    },
    async maximumReportBytes(request: ExecutionRequest) {
      const policy = interpolatePolicy(
        await loadPolicy(request.configPath, request.workspaceRoot),
        {
          phase: request.phase,
          environment: request.environment,
          ...(request.targetOverride === undefined
            ? {}
            : { targetOverride: request.targetOverride })
        }
      );
      return parseByteSize(policy.limits.maximum_report_size, 25 * 1024 * 1024);
    }
  };
}
