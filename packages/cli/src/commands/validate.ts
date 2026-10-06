import type { CommandContext, CommonOptions } from "./types.js";
import { executionRequest } from "./types.js";
import { writeDiagnostics } from "../output.js";

export async function validateCommand(
  options: CommonOptions,
  context: CommandContext
): Promise<number> {
  const diagnostics = await context.service.validate(executionRequest(options, context));
  writeDiagnostics(diagnostics, context.output, options.json === true);
  if (diagnostics.length > 0) return 3;
  context.output.stdout(options.json === true ? '{"valid":true}\n' : "Configuration is valid.\n");
  return 0;
}
