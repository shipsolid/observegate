#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import {
  ObservabilityGateService,
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
  return new ObservabilityGateService<RawPolicy>({
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
  let exitCode = 0;
  const program = new Command()
    .name("observability-gate")
    .description("Evidence-driven deployment gates for observability and reliability")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: output.stdout,
      writeErr: output.stderr
    });

  program
    .command("validate")
    .requiredOption("--config <path>")
    .option("--phase <phase>", "phase to validate", "pre_deployment")
    .option("--target <id>")
    .option("--json")
    .action(async (options) => {
      exitCode = await validateCommand(options, context);
    });
  program
    .command("plan")
    .requiredOption("--config <path>")
    .requiredOption("--phase <phase>")
    .option("--target <id>")
    .option("--json")
    .action(async (options) => {
      exitCode = await planCommand(options, context);
    });
  program
    .command("run")
    .requiredOption("--config <path>")
    .requiredOption("--phase <phase>")
    .option("--target <id>")
    .option("--output-directory <path>")
    .option("--json")
    .action(async (options) => {
      exitCode = await runCommand(options, context);
    });
  program
    .command("explain")
    .argument("<gate>")
    .option("--config <path>")
    .option("--phase <phase>", "phase used for configured gate IDs", "pre_deployment")
    .option("--target <id>")
    .action(async (identifier, options) => {
      exitCode = await explainCommand(identifier, options, context);
    });
  program
    .command("catalog")
    .option("--json")
    .action((options) => {
      exitCode = catalogCommand(options.json === true, context);
    });

  try {
    await program.parseAsync([...argv], { from: "user" });
    return signal.aborted ? 3 : exitCode;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
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
