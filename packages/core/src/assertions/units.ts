import { GateError } from "../errors/gate-error.js";
import type { AssertionUnit, NumericValue } from "./types.js";

interface NormalizedNumericPair {
  readonly observed: number;
  readonly expected: number;
  readonly unit?: AssertionUnit;
}

interface UnitDefinition {
  readonly family: string;
  readonly canonicalUnit: AssertionUnit;
  readonly multiplier: number;
}

const unitDefinitions: Readonly<Record<AssertionUnit, UnitDefinition>> = {
  percent: { family: "percent", canonicalUnit: "percent", multiplier: 1 },
  ratio: { family: "ratio", canonicalUnit: "ratio", multiplier: 1 },
  count: { family: "count", canonicalUnit: "count", multiplier: 1 },
  seconds: { family: "duration", canonicalUnit: "milliseconds", multiplier: 1000 },
  milliseconds: { family: "duration", canonicalUnit: "milliseconds", multiplier: 1 },
  bytes: { family: "bytes", canonicalUnit: "bytes", multiplier: 1 },
  bytes_per_second: {
    family: "bytes_per_second",
    canonicalUnit: "bytes_per_second",
    multiplier: 1
  },
  requests_per_second: {
    family: "requests_per_second",
    canonicalUnit: "requests_per_second",
    multiplier: 1
  },
  events_per_second: {
    family: "events_per_second",
    canonicalUnit: "events_per_second",
    multiplier: 1
  }
};

function invalid(message: string): never {
  throw new GateError({
    code: "EVIDENCE_INVALID",
    safeMessage: message,
    retryable: false
  });
}

export function normalizeNumericPair(
  observed: NumericValue,
  expected: NumericValue
): NormalizedNumericPair {
  if (!Number.isFinite(observed.value) || !Number.isFinite(expected.value)) {
    invalid("Numeric evidence must be finite.");
  }
  if (observed.unit === undefined && expected.unit === undefined) {
    return { observed: observed.value, expected: expected.value };
  }
  if (observed.unit === undefined || expected.unit === undefined) {
    invalid("Observed and expected numeric values must declare compatible units.");
  }

  const observedDefinition = unitDefinitions[observed.unit];
  const expectedDefinition = unitDefinitions[expected.unit];
  if (observedDefinition.family !== expectedDefinition.family) {
    invalid(`Incompatible units: ${observed.unit} and ${expected.unit}.`);
  }

  return {
    observed: observed.value * observedDefinition.multiplier,
    expected: expected.value * expectedDefinition.multiplier,
    unit: observedDefinition.canonicalUnit
  };
}
