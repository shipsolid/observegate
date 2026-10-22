#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import {
  GateError,
  ObservabilityGateService,
  parseByteSize,
  type GateCatalogMetadata
} from "@observability-gate/core";
import {
  createExecutionPlan,
  describePolicyExecution,
  publicationOptions,
  interpolatePolicy,
  loadPolicy,
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
    validate: (request) => service.validate(request),
    plan: (request) => service.plan(request),
    run: (request) => service.run(request),
    async publicationOptions(request) {
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
