import { normalizeNumericPair } from "@observability-gate/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("unit conversion properties", () => {
  it("normalizes equivalent seconds and milliseconds to the same canonical value", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
        (seconds) => {
          const normalized = normalizeNumericPair(
            { value: seconds, unit: "seconds" },
            { value: seconds * 1_000, unit: "milliseconds" }
          );
          expect(normalized.unit).toBe("milliseconds");
          expect(normalized.observed).toBeCloseTo(normalized.expected, 8);
        }
      ),
      { numRuns: 250 }
    );
  });

  it("rejects every incompatible unit-family pair", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("percent", "count", "bytes", "requests_per_second" as const),
        fc.constantFrom("seconds", "ratio", "events_per_second" as const),
        (left, right) => {
          if (left === right) return;
          expect(() =>
            normalizeNumericPair({ value: 1, unit: left }, { value: 1, unit: right })
          ).toThrow();
        }
      )
    );
  });
});
