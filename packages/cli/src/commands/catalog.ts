import type { CommandContext } from "./types.js";

export function catalogCommand(json: boolean, context: CommandContext): number {
  const entries = Object.values(context.catalog).sort((left, right) =>
    left.type.localeCompare(right.type)
  );
  context.output.stdout(
    json
      ? `${JSON.stringify(entries)}\n`
      : `${entries.map((item) => `${item.type}\t${item.description}`).join("\n")}\n`
  );
  return 0;
}
