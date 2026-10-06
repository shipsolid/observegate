import { isDeepStrictEqual } from "node:util";
import type { AssertionResult, Diagnostic, GateStatus } from "../domain/gates.js";
import { GateError } from "../errors/gate-error.js";
import type {
  AssertionDefinition,
  AssertionUnit,
  NumericAssertion,
  NumericAssertionType,
  NumericValue
} from "./types.js";
import { normalizeNumericPair } from "./units.js";

type AssertionStatus = Exclude<GateStatus, "skipped" | "warned" | "inconclusive">;

function baseResult(
  definition: AssertionDefinition,
  status: AssertionStatus,
  observed: unknown,
  expected: unknown,
  message: string,
  unit?: AssertionUnit
): AssertionResult {
  return Object.freeze({
    assertion: definition.label ?? definition.type,
    status,
    observed,
    expected,
    ...(unit === undefined ? {} : { unit }),
    message
  });
}

function invalidResult(
  definition: AssertionDefinition,
  observed: unknown,
  error: GateError
): AssertionResult {
  const diagnostic: Diagnostic = error.toDiagnostic();
  return Object.freeze({
    assertion: definition.label ?? definition.type,
    status: "error",
    observed,
    message: error.safeMessage,
    diagnostic
  });
}

function isNumericValue(value: unknown): value is NumericValue {
  return (
    value !== null &&
    typeof value === "object" &&
    "value" in value &&
    typeof value.value === "number" &&
    (!("unit" in value) || typeof value.unit === "string")
  );
}

function numericValue(value: unknown): NumericValue {
  if (typeof value === "number") {
    return { value };
  }
  if (isNumericValue(value)) {
    return value;
  }
  throw new GateError({
    code: "EVIDENCE_INVALID",
    safeMessage: "Numeric assertion received a non-numeric value.",
    retryable: false
  });
}

function compare(
  operator: NumericAssertionType | "equals" | "not_equals",
  left: number,
  right: number
) {
  switch (operator) {
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "greater_than":
      return left > right;
    case "greater_than_or_equal":
      return left >= right;
    case "less_than":
      return left < right;
    case "less_than_or_equal":
      return left <= right;
  }
}

function evaluateNumeric(definition: NumericAssertion, observed: unknown): AssertionResult {
  try {
    const pair = normalizeNumericPair(numericValue(observed), {
      value: definition.expected,
      ...(definition.unit === undefined ? {} : { unit: definition.unit })
    });
    const passed = compare(definition.type, pair.observed, pair.expected);
    return baseResult(
      definition,
      passed ? "passed" : "failed",
      pair.observed,
      pair.expected,
      passed ? "Numeric assertion passed." : "Numeric assertion failed.",
      pair.unit
    );
  } catch (error) {
    if (error instanceof GateError) {
      return invalidResult(definition, observed, error);
    }
    throw error;
  }
}

function observedCount(observed: unknown): number {
  if (Array.isArray(observed) || typeof observed === "string") {
    return observed.length;
  }
  if (observed instanceof Map || observed instanceof Set) {
    return observed.size;
  }
  if (typeof observed === "number") {
    return observed;
  }
  throw new GateError({
    code: "EVIDENCE_INVALID",
    safeMessage: "Count assertion received a value without a count.",
    retryable: false
  });
}

function compositeResult(
  definition: AssertionDefinition,
  status: AssertionStatus,
  children: readonly AssertionResult[],
  requiredPassCount?: number
): AssertionResult {
  const observedPassCount = children.filter((child) => child.status === "passed").length;
  return Object.freeze({
    assertion: definition.label ?? definition.type,
    status,
    observed: observedPassCount,
    expected: requiredPassCount,
    message: status === "passed" ? "Composite assertion passed." : "Composite assertion failed.",
    children: Object.freeze([...children]),
    ...(requiredPassCount === undefined ? {} : { requiredPassCount, observedPassCount })
  });
}

function assertNever(value: never): never {
  throw new Error(`Unsupported assertion: ${JSON.stringify(value)}`);
}

export function evaluateAssertion(
  definition: AssertionDefinition,
  observed: unknown
): AssertionResult {
  switch (definition.type) {
    case "equals": {
      const passed = isDeepStrictEqual(observed, definition.expected);
      return baseResult(
        definition,
        passed ? "passed" : "failed",
        observed,
        definition.expected,
        passed ? "Values are equal." : "Values are not equal."
      );
    }
    case "not_equals": {
      const passed = !isDeepStrictEqual(observed, definition.expected);
      return baseResult(
        definition,
        passed ? "passed" : "failed",
        observed,
        definition.expected,
        passed ? "Values are different." : "Values are equal."
      );
    }
    case "greater_than":
    case "greater_than_or_equal":
    case "less_than":
    case "less_than_or_equal":
      return evaluateNumeric(definition, observed);
    case "allowed_values": {
      const passed = definition.expected.some((expected) => isDeepStrictEqual(observed, expected));
      return baseResult(
        definition,
        passed ? "passed" : "failed",
        observed,
        definition.expected,
        passed ? "Value is allowed." : "Value is not allowed."
      );
    }
    case "forbidden_values": {
      const passed = !definition.expected.some((expected) => isDeepStrictEqual(observed, expected));
      return baseResult(
        definition,
        passed ? "passed" : "failed",
        observed,
        definition.expected,
        passed ? "Value is not forbidden." : "Value is forbidden."
      );
    }
    case "present": {
      const passed = observed !== undefined && observed !== null;
      return baseResult(
        definition,
        passed ? "passed" : "failed",
        observed,
        "present",
        passed ? "Value is present." : "Value is absent."
      );
    }
    case "absent": {
      const passed = observed === undefined || observed === null;
      return baseResult(
        definition,
        passed ? "passed" : "failed",
        observed,
        "absent",
        passed ? "Value is absent." : "Value is present."
      );
    }
    case "count":
      try {
        const pair = normalizeNumericPair(
          { value: observedCount(observed), unit: "count" },
          { value: definition.expected, unit: "count" }
        );
        const passed = compare(definition.operator, pair.observed, pair.expected);
        return baseResult(
          definition,
          passed ? "passed" : "failed",
          pair.observed,
          pair.expected,
          passed ? "Count assertion passed." : "Count assertion failed.",
          pair.unit
        );
      } catch (error) {
        if (error instanceof GateError) {
          return invalidResult(definition, observed, error);
        }
        throw error;
      }
    case "freshness":
      return evaluateNumeric(
        {
          type: "less_than_or_equal",
          expected: definition.maximumAgeMs,
          unit: "milliseconds",
          ...(definition.label === undefined ? {} : { label: definition.label })
        },
        typeof observed === "number" ? { value: observed, unit: "milliseconds" } : observed
      );
    case "all": {
      const children = definition.assertions.map((child) => evaluateAssertion(child, observed));
      const status = children.some((child) => child.status === "error")
        ? "error"
        : children.every((child) => child.status === "passed")
          ? "passed"
          : "failed";
      return compositeResult(definition, status, children, children.length);
    }
    case "any": {
      const children = definition.assertions.map((child) => evaluateAssertion(child, observed));
      const status = children.some((child) => child.status === "passed")
        ? "passed"
        : children.some((child) => child.status === "error")
          ? "error"
          : "failed";
      return compositeResult(definition, status, children, 1);
    }
    case "minimum_passing": {
      const children = definition.assertions.map((child) => evaluateAssertion(child, observed));
      const passed = children.filter((child) => child.status === "passed").length;
      const status =
        passed >= definition.minimum
          ? "passed"
          : children.some((child) => child.status === "error")
            ? "error"
            : "failed";
      return compositeResult(definition, status, children, definition.minimum);
    }
    default:
      return assertNever(definition);
  }
}
