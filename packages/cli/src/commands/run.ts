import { GateError } from "@observability-gate/core";
import { writeReports } from "@observability-gate/reporters";
import { exitCodeForDecision, writeResult } from "../output.js";
import type { CommandContext, CommonOptions } from "./types.js";
import { executionRequest } from "./types.js";

export interface RunOptions extends CommonOptions {
  readonly outputDirectory?: string;
}

export async function runCommand(options: RunOptions, context: CommandContext): Promise<number> {
  const request = executionRequest(options, context);
  const result = await context.service.run(request);
  try {
    const publication = await context.service.publicationOptions?.(request);
    const directory = options.outputDirectory ?? publication?.directory;
    if (directory !== undefined) {
      const maximumTotalBytes =
        (await context.service.maximumReportBytes?.(request)) ?? 25 * 1024 * 1024;
      await writeReports(result, {
        directory,
        formats: publication?.formats ?? ["json", "markdown", "junit", "sarif"],
        maximumTotalBytes,
        signal: context.signal
      });
    }
  } catch (error) {
    const reportError =
      error instanceof GateError
        ? error
        : new GateError({
            code: "REPORTING",
            safeMessage: "Report publication failed.",
            retryable: false,
            cause: error
          });
    context.output.stderr(`${reportError.code}: ${reportError.safeMessage}\n`);
    writeResult({ ...result, decision: result.decision === "fail" ? "fail" : "error", diagnostics: [...result.diagnostics, reportError.toDiagnostic()] }, context.output, options.json === true);
    return result.decision === "fail" ? 1 : 3;
  }
  writeResult(result, context.output, options.json === true);
  return exitCodeForDecision(result.decision);
}
