import * as core from "@actions/core";
import type { ExecutionResult } from "@observability-gate/core";
import { writeReports } from "@observability-gate/reporters";
import { publishCheck, updatePullRequestComment, writeStepSummary } from "./github-reporter.js";
import { readInputs } from "./inputs.js";
import { setActionOutputs } from "./outputs.js";
import { createActionService } from "./service.js";

export interface ActionService {
  readonly run: (request: {
    readonly workspaceRoot: string;
    readonly configPath: string;
    readonly phase: "pre_deployment" | "post_deployment";
    readonly targetOverride?: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    readonly cancellationSignal: AbortSignal;
  }) => Promise<ExecutionResult>;
}

export interface RunActionDependencies {
  readonly service?: ActionService;
  readonly workspaceRoot?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

function shouldFail(result: ExecutionResult): boolean {
  return (
    result.decision === "fail" || result.decision === "inconclusive" || result.decision === "error"
  );
}

export async function runAction(dependencies: RunActionDependencies = {}): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const inputs = readInputs();
    const service = dependencies.service ?? createActionService();
    const result = await service.run({
      workspaceRoot: dependencies.workspaceRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd(),
      configPath: inputs.config,
      phase: inputs.phase,
      ...(inputs.target === undefined ? {} : { targetOverride: inputs.target }),
      environment: dependencies.environment ?? process.env,
      cancellationSignal: controller.signal
    });
    const publication = await writeReports(result, {
      directory: inputs.outputDirectory,
      formats: ["json", "markdown", "junit", "sarif"],
      maximumTotalBytes: 10 * 1024 * 1024,
      signal: controller.signal
    });
    setActionOutputs(result, publication.paths.json ?? "");
    await writeStepSummary(result);
    if (inputs.githubToken !== undefined) {
      try {
        await publishCheck(result, inputs.githubToken);
        await updatePullRequestComment(result, inputs.githubToken);
      } catch {
        core.warning("GitHub report publication was not authorized; local reports are available.");
      }
    }
    if (shouldFail(result)) core.setFailed(`Observability Gate decision: ${result.decision}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Observability Gate Action failed.";
    core.setFailed(message);
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

if (process.env.NODE_ENV !== "test") {
  await runAction();
}
