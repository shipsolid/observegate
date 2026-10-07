#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  ObservabilityGateService,
  parseByteSize,
  stableFingerprint,
  type GateCatalogMetadata
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
import { catalogCommand } from "./commands/catalog.js";
import { explainCommand } from "./commands/explain.js";
import { planCommand } from "./commands/plan.js";
import { runCommand } from "./commands/run.js";
import type { CliService, CommandContext } from "./commands/types.js";
import { validateCommand } from "./commands/validate.js";
import type { OutputWriter } from "./output.js";
import { CliUsageError, helpText, parseCliArguments } from "./arguments.js";

export interface CliDependencies {
  readonly service?: CliService;
  readonly catalog?: GateCatalogMetadata;
  readonly output?: OutputWriter;
  readonly workspaceRoot?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly signal?: AbortSignal;
}

function durationMs(value: string | undefined): number {
  if (value === undefined) return 0;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return 0;
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]] ?? 0;
  return Number(match[1]) * multiplier;
}

function createDefaultService(catalog = createBuiltInGateCatalog()): CliService {
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
      describeExecution(policy, plan, request) {
        const target = policy.targets.definitions[plan.targetId];
        const runtimeProvider = target?.runtime.provider;
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
            provider: typeof runtimeProvider === "string" ? runtimeProvider : "unresolved"
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
          missingEvidenceBehavior: {
            blocking:
              policy.observation.no_data?.blocking_gate === "inconclusive"
                ? "inconclusive"
                : policy.observation.no_data?.blocking_gate === "warn"
                  ? "warn"
                  : "fail",
            advisory: "warn"
          },
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
    validate: (request) => service.validate(request),
    plan: (request) => service.plan(request),
    run: (request) => service.run(request),
    async maximumReportBytes(request) {
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

export async function runCli(
  argv: readonly string[],
  dependencies: CliDependencies = {}
): Promise<number> {
  const output: OutputWriter =
    dependencies.output ??
    ({
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text)
    } satisfies OutputWriter);
  const catalog = dependencies.catalog ?? createBuiltInGateCatalog().metadata();
  const controller = dependencies.signal === undefined ? new AbortController() : undefined;
  const signal = dependencies.signal ?? (controller as AbortController).signal;
  const cancel = () => controller?.abort();
  if (controller !== undefined) {
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
  }
  const context: CommandContext = {
    service: dependencies.service ?? createDefaultService(),
    catalog,
    output,
    workspaceRoot: dependencies.workspaceRoot ?? process.cwd(),
    environment: dependencies.environment ?? process.env,
    signal
  };
  try {
    const command = parseCliArguments(argv);
    let exitCode: number;
    switch (command.name) {
      case "help":
        output.stdout(helpText);
        exitCode = 0;
        break;
      case "validate":
        exitCode = await validateCommand(command.options, context);
        break;
      case "plan":
        exitCode = await planCommand(command.options, context);
        break;
      case "run":
        exitCode = await runCommand(command.options, context);
        break;
      case "explain":
        exitCode = await explainCommand(command.identifier, command.options, context);
        break;
      case "catalog":
        exitCode = catalogCommand(command.json, context);
        break;
    }
    return signal.aborted ? 3 : exitCode;
  } catch (error) {
    if (error instanceof CliUsageError) {
      output.stderr(`${error.message}\n${helpText}`);
      return 1;
    }
    output.stderr("INTERNAL: Command execution failed.\n");
    return 3;
  } finally {
    if (controller !== undefined) {
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
    }
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
