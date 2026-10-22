import type { CommandContext } from "./types.js";
import { discoveryMetadata, discoveryText } from "./discovery.js";

export function catalogCommand(json: boolean, context: CommandContext): number {
  const entries = Object.values(context.catalog).sort((left, right) =>
    left.type.localeCompare(right.type)
  );
  context.output.stdout(
    json
      ? `${JSON.stringify(entries.map(discoveryMetadata))}\n`
      : `${entries.map((item) => `${item.type}\n${discoveryText(item)}`).join("\n")}\n`
  );
  return 0;
}
