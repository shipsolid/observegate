import { GateError, type Phase } from "@observability-gate/core";
import type { ConfigValue } from "../schema/common.js";

const supportedConditionKeys = new Set([
  "phase",
  "runtime_type",
  "operating_system",
  "provider_available"
]);

export interface ConditionContext {
  readonly phase: Phase;
  readonly runtimeType: string;
  readonly operatingSystem?: string;
  readonly availableProviders: ReadonlySet<string>;
}

function matches(actual: string | undefined, expected: ConfigValue): boolean {
  if (Array.isArray(expected)) {
    return expected.some((value) => typeof value === "string" && value === actual);
  }
  return typeof expected === "string" && expected === actual;
}

export function evaluateConditions(
  conditions: Readonly<Record<string, ConfigValue>> | undefined,
  context: ConditionContext
): boolean {
  if (conditions === undefined) {
    return true;
  }

  return Object.entries(conditions).every(([key, expected]) => {
    if (!supportedConditionKeys.has(key)) {
      throw new GateError({
        code: "CONFIG_REFERENCE",
        safeMessage: `Unsupported gate condition: ${key}`,
        retryable: false
      });
    }

    switch (key) {
      case "phase":
        return matches(context.phase, expected);
      case "runtime_type":
        return matches(context.runtimeType, expected);
      case "operating_system":
        return matches(context.operatingSystem, expected);
      case "provider_available":
        if (Array.isArray(expected)) {
          return expected.some(
            (provider) => typeof provider === "string" && context.availableProviders.has(provider)
          );
        }
        return typeof expected === "string" && context.availableProviders.has(expected);
      default:
        return false;
    }
  });
}
