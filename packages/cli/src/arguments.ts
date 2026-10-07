import type { CommonOptions } from "./commands/types.js";
import type { RunOptions } from "./commands/run.js";

export type ParsedCommand =
  | { readonly name: "validate"; readonly options: CommonOptions }
  | { readonly name: "plan"; readonly options: CommonOptions }
  | { readonly name: "run"; readonly options: RunOptions }
  | {
      readonly name: "explain";
      readonly identifier: string;
      readonly options: Partial<CommonOptions>;
    }
  | { readonly name: "catalog"; readonly json: boolean }
  | { readonly name: "help" };

export class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export const helpText = `Usage: observability-gate <command> [options]

Evidence-driven deployment gates for observability and reliability

Commands:
  validate --config <path> [--phase <phase>] [--target <id>] [--json]
  plan --config <path> --phase <phase> [--target <id>] [--json]
  run --config <path> --phase <phase> [--target <id>] [--output-directory <path>] [--json]
  explain <gate> [--config <path>] [--phase <phase>] [--target <id>]
  catalog [--json]
`;

type OptionName = "config" | "phase" | "target" | "outputDirectory";

interface ParsedOptions {
  readonly values: Partial<Record<OptionName, string>>;
  readonly json: boolean;
  readonly positional: readonly string[];
}

function parseOptions(
  args: readonly string[],
  allowedValues: ReadonlyMap<string, OptionName>,
  allowJson: boolean
): ParsedOptions {
  const values: Partial<Record<OptionName, string>> = {};
  const positional: string[] = [];
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === "--json" && allowJson) {
      json = true;
      continue;
    }
    if (argument.startsWith("--")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      const name = allowedValues.get(flag);
      if (name === undefined) throw new CliUsageError(`error: unknown option '${flag}'`);
      const inline = separator === -1 ? undefined : argument.slice(separator + 1);
      const value = inline ?? args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith("--")) {
        throw new CliUsageError(`error: option '${flag} <value>' argument missing`);
      }
      values[name] = value;
      if (inline === undefined) index += 1;
      continue;
    }
    positional.push(argument);
  }

  return { values, json, positional };
}

function requireOption(values: ParsedOptions["values"], name: OptionName, flag: string): string {
  const value = values[name];
  if (value === undefined) {
    throw new CliUsageError(`error: required option '${flag} <path>' not specified`);
  }
  return value;
}

function noPositionals(command: string, positional: readonly string[]): void {
  if (positional.length > 0) {
    throw new CliUsageError(`error: command '${command}' does not accept arguments`);
  }
}

const commonOptions = new Map<string, OptionName>([
  ["--config", "config"],
  ["--phase", "phase"],
  ["--target", "target"]
]);

export function parseCliArguments(argv: readonly string[]): ParsedCommand {
  const [command, ...args] = argv;
  if (command === "--help" || command === "-h") return { name: "help" };
  if (command === undefined) throw new CliUsageError("error: command required");

  if (args.includes("--help") || args.includes("-h")) return { name: "help" };

  switch (command) {
    case "validate": {
      const parsed = parseOptions(args, commonOptions, true);
      noPositionals(command, parsed.positional);
      return {
        name: command,
        options: {
          config: requireOption(parsed.values, "config", "--config"),
          phase: parsed.values.phase ?? "pre_deployment",
          ...(parsed.values.target === undefined ? {} : { target: parsed.values.target }),
          ...(parsed.json ? { json: true } : {})
        }
      };
    }
    case "plan":
    case "run": {
      const allowed = new Map(commonOptions);
      if (command === "run") allowed.set("--output-directory", "outputDirectory");
      const parsed = parseOptions(args, allowed, true);
      noPositionals(command, parsed.positional);
      const config = requireOption(parsed.values, "config", "--config");
      const phase = parsed.values.phase;
      if (phase === undefined) {
        throw new CliUsageError("error: required option '--phase <phase>' not specified");
      }
      const options: RunOptions = {
        config,
        phase,
        ...(parsed.values.target === undefined ? {} : { target: parsed.values.target }),
        ...(parsed.values.outputDirectory === undefined
          ? {}
          : { outputDirectory: parsed.values.outputDirectory }),
        ...(parsed.json ? { json: true } : {})
      };
      return { name: command, options };
    }
    case "explain": {
      const parsed = parseOptions(args, commonOptions, false);
      if (parsed.positional.length !== 1 || parsed.positional[0] === undefined) {
        throw new CliUsageError("error: command 'explain' requires exactly one gate identifier");
      }
      return {
        name: command,
        identifier: parsed.positional[0],
        options: {
          ...(parsed.values.config === undefined ? {} : { config: parsed.values.config }),
          phase: parsed.values.phase ?? "pre_deployment",
          ...(parsed.values.target === undefined ? {} : { target: parsed.values.target })
        }
      };
    }
    case "catalog": {
      const parsed = parseOptions(args, new Map(), true);
      noPositionals(command, parsed.positional);
      return { name: command, json: parsed.json };
    }
    default:
      throw new CliUsageError(`error: unknown command '${command}'`);
  }
}
