import {
  ObservabilityGateService,
  parseByteSize,
  stableFingerprint,
  type ExecutionRequest
} from "@observability-gate/core";
import {
  createExecutionPlan,
  interpolatePolicy,
  loadPolicy,
  type RawPolicy
} from "@observability-gate/config";
import {
  createBuiltInGateCatalog,
  executeGate as executeCatalogGate
} from "@observability-gate/gates";
import { createPolicyProviderSession } from "@observability-gate/providers/session";

function durationMs(value: string | undefined): number {
  if (value === undefined) return 0;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return 0;
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]] ?? 0;
  return Number(match[1]) * multiplier;
}

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
      createPlan: (policy, request) =>
        createExecutionPlan({ policy, phase: request.phase, catalog: catalog.metadata() }),
      describeExecution(policy, plan, request: ExecutionRequest) {
        const target = policy.targets.definitions[plan.targetId];
        const links = Object.fromEntries(
          Object.entries(policy.reporting.links ?? {}).flatMap(([name, environmentName]) => {
            const value =
              typeof environmentName === "string"
                ? request.environment[environmentName]
                : undefined;
            return value === undefined ? [] : [[name, value]];
          })
        );
        return {
          phase: request.phase,
          target: {
            id: plan.targetId,
            runtimeType: plan.runtimeType,
            provider:
              typeof target?.runtime.provider === "string" ? target.runtime.provider : "unresolved"
          },
          release: {
            candidateId: policy.release.candidate.id,
            deploymentId: policy.identity.canonical.deployment_id,
            ...(policy.release.baseline?.explicit_release_id === undefined
              ? {}
              : { baselineId: policy.release.baseline.explicit_release_id })
          },
          decisionPolicy: {
            minimumEvidenceCoveragePercent:
              policy.execution.enforcement?.minimum_evidence_coverage_percent ?? 100,
            warnOnSkipped: true
          },
          missingEvidenceBehavior: { blocking: "fail" as const, advisory: "warn" as const },
          observation: {
            warmupMs: durationMs(policy.observation.post_deployment.warmup),
            evaluationWindowMs: durationMs(policy.observation.post_deployment.evaluation_window),
            sampleIntervalMs: durationMs(policy.observation.post_deployment.settle_between_samples),
            minimumSuccessfulSamples:
              policy.observation.post_deployment.minimum_successful_samples ?? 1,
            maximumExtensionMs: durationMs(policy.release.comparison?.maximum_extension)
          },
          links,
          configurationFingerprint: stableFingerprint(policy)
        };
      }
    },
    providers: {
      async initialize(_requirements, context) {
        return createPolicyProviderSession({
          policy: context.policy,
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
