import type { CommandContext, CommonOptions } from "./types.js";
import { executionRequest } from "./types.js";
import { discoveryMetadata, discoveryText } from "./discovery.js";

export async function explainCommand(
  identifier: string,
  options: Partial<CommonOptions>,
  context: CommandContext
): Promise<number> {
  const direct = context.catalog[identifier];
  if (direct !== undefined) {
    context.output.stdout(
      options.json ? `${JSON.stringify(discoveryMetadata(direct))}\n` : `${identifier}\n${discoveryText(direct)}`
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
        options.json ? `${JSON.stringify({ id: gate.id, type: gate.type, enforcement: gate.enforcement, applicability: gate.applicability, ...(metadata === undefined ? {} : discoveryMetadata(metadata)), remediation: gate.definition.remediation })}\n` : `${gate.id}\nType: ${gate.type}\n${metadata === undefined ? "No description available." : discoveryText(metadata)}\nEnforcement: ${gate.enforcement}\nApplicability: ${gate.applicability}\n${typeof gate.definition.remediation === "string" ? `Remediation: ${gate.definition.remediation}\n` : ""}`
      );
      return 0;
    }
  }
  context.output.stderr(`Unknown gate: ${identifier}\n`);
  return 3;
}
