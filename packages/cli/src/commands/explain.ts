import type { CommandContext, CommonOptions } from "./types.js";
import { executionRequest } from "./types.js";

export async function explainCommand(
  identifier: string,
  options: Partial<CommonOptions>,
  context: CommandContext
): Promise<number> {
  const direct = context.catalog[identifier];
  if (direct !== undefined) {
    context.output.stdout(
      `${identifier}\n${direct.description}\nPhases: ${direct.supportedPhases.join(", ")}\n`
    );
    return 0;
  }
  if (options.config !== undefined) {
    const plan = await context.service.plan(
      executionRequest({ ...options, config: options.config }, context)
    );
    const gate = plan.gates.find((item) => item.id === identifier);
    if (gate !== undefined) {
      const metadata = context.catalog[gate.type];
      context.output.stdout(
        `${gate.id}\nType: ${gate.type}\n${metadata?.description ?? "No description available."}\n`
      );
      return 0;
    }
  }
  context.output.stderr(`Unknown gate: ${identifier}\n`);
  return 3;
}
