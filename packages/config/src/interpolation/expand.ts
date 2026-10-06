import { GateError } from "@observability-gate/core";

const variablePattern = /(?<!\\)\$\{([A-Z][A-Z0-9_]*)\}/g;

type MissingVariableBehavior = "error" | "preserve";

function replaceVariables(
  value: string,
  environment: Readonly<Record<string, string | undefined>>,
  missingVariableBehavior: MissingVariableBehavior
): string {
  return value.replace(variablePattern, (match, name: string, offset: number, source: string) => {
    const prefix = source.slice(0, offset);
    const nestedStart = prefix.lastIndexOf("${") > prefix.lastIndexOf("}");
    const nestedEnd = source[offset + match.length] === "}";
    if (nestedStart || nestedEnd) {
      return match;
    }

    const replacement = environment[name];
    if (replacement === undefined || replacement.length === 0) {
      if (missingVariableBehavior === "preserve") {
        return match;
      }
      throw new GateError({
        code: "CONFIG_SCHEMA",
        safeMessage: `Missing required environment variable: ${name}`,
        retryable: false
      });
    }
    return replacement;
  });
}

export function expandString(
  value: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  return replaceVariables(value, environment, "error");
}

export function expandValue<T>(
  value: T,
  environment: Readonly<Record<string, string | undefined>>,
  missingVariableBehavior: MissingVariableBehavior = "error"
): T {
  if (typeof value === "string") {
    return replaceVariables(value, environment, missingVariableBehavior) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandValue(item, environment, missingVariableBehavior)) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        expandValue(item, environment, missingVariableBehavior)
      ])
    ) as T;
  }
  return value;
}
