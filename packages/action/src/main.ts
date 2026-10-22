import { GateError, type ExecutionRequest, type ExecutionResult } from "@observability-gate/core";
import type { GithubReportingOptions, PublicationOptions } from "@observability-gate/config";
import { writeReports } from "@observability-gate/reporters";
import { publishCheck, updatePullRequestComment, writeStepSummary } from "./github-reporter.js";
import { readInputs } from "./inputs.js";
import { setActionOutputs } from "./outputs.js";
import { createActionService } from "./service.js";
import { githubActionsRuntime, type ActionRuntime } from "./actions-runtime.js";

export interface ActionService {
  readonly run: (request: ExecutionRequest) => Promise<ExecutionResult>;
  readonly maximumReportBytes?: (request: ExecutionRequest) => Promise<number>;
  readonly publicationOptions?: (request: ExecutionRequest) => Promise<PublicationOptions>;
  readonly reportingOptions?: (request: ExecutionRequest) => Promise<GithubReportingOptions>;
}

export interface RunActionDependencies {
  readonly service?: ActionService;
  readonly workspaceRoot?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly runtime?: ActionRuntime;
  readonly providerOptions?: Parameters<typeof createActionService>[0];
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
    const runtime = dependencies.runtime ?? githubActionsRuntime;
    const inputs = readInputs(runtime);
    const service = dependencies.service ?? createActionService(dependencies.providerOptions);
    const request: ExecutionRequest = {
      workspaceRoot: dependencies.workspaceRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd(),
      configPath: inputs.config,
      phase: inputs.phase,
      ...(inputs.target === undefined ? {} : { targetOverride: inputs.target }),
      environment: dependencies.environment ?? process.env,
      cancellationSignal: controller.signal
    };
    const result = await service.run(request);
    const checkCancellation = () => {
      if (controller.signal.aborted)
        throw new GateError({
          code: "CANCELLED",
          safeMessage: "Action publication was cancelled.",
          retryable: false
        });
    };
    checkCancellation();
    const publicationSettings = await service.publicationOptions?.(request);
    const reporting = publicationSettings?.github ??
      (await service.reportingOptions?.(request)) ?? {
        checkRun: false,
        stepSummary: true,
        pullRequestComment: false
      };
    checkCancellation();
    const maximumTotalBytes = (await service.maximumReportBytes?.(request)) ?? 25 * 1024 * 1024;
    const publication = await writeReports(result, {
      directory:
        runtime.getInput("output-directory") ||
        publicationSettings?.directory ||
        inputs.outputDirectory,
      formats: publicationSettings?.formats ?? ["json", "markdown", "junit", "sarif"],
      maximumTotalBytes,
      signal: controller.signal
    });
    checkCancellation();
    if (reporting.stepSummary) await writeStepSummary(result, runtime, reporting);
    checkCancellation();
    if (inputs.githubToken !== undefined) {
      try {
        if (reporting.checkRun)
          await publishCheck(result, inputs.githubToken, controller.signal, reporting);
        checkCancellation();
        if (reporting.pullRequestComment)
          await updatePullRequestComment(result, inputs.githubToken, controller.signal, reporting);
      } catch {
        runtime.warning(
          "GitHub report publication was not authorized; local reports are available."
        );
      }
    }
    checkCancellation();
    setActionOutputs(result, publication.paths.json ?? "", runtime);
    if (shouldFail(result)) runtime.setFailed(`Observability Gate decision: ${result.decision}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Observability Gate Action failed.";
    (dependencies.runtime ?? githubActionsRuntime).setFailed(message);
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

if (process.env.NODE_ENV !== "test") {
  await runAction();
}
