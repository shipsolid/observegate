import type { CommandContext, CommonOptions } from "./types.js";
import { executionRequest } from "./types.js";
import { safePlanDto } from "../output.js";

export async function planCommand(
  options: CommonOptions,
  context: CommandContext
): Promise<number> {
  const plan = await context.service.plan(executionRequest(options, context));
  const safe = safePlanDto(plan);
  context.output.stdout(
    options.json === true
      ? `${JSON.stringify(safe)}\n`
      : `Phase: ${plan.phase}\nTarget: ${plan.targetId}\nGates: ${plan.gates.length}\nProviders: ${plan.requiredProviders.map((item) => `${item.provider}:${item.capability}`).join(", ")}\n`
  );
  return 0;
}
