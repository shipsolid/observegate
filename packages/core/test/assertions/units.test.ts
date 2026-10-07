import { describe, expect, it } from "vitest";
import { normalizeNumericPair } from "../../src/assertions/units.js";

describe("normalizeNumericPair", () => {
  it("normalizes seconds and milliseconds to the same duration family", () => {
    expect(
      normalizeNumericPair({ value: 750, unit: "milliseconds" }, { value: 0.75, unit: "seconds" })
    ).toEqual({ observed: 750, expected: 750, unit: "milliseconds" });
  });

  it("preserves unitless values and converts duration operands independently", () => {
    expect(normalizeNumericPair({ value: 2 }, { value: 3 })).toEqual({
      observed: 2,
      expected: 3
    });
    expect(
      normalizeNumericPair({ value: 2, unit: "seconds" }, { value: 3000, unit: "milliseconds" })
    ).toEqual({ observed: 2000, expected: 3000, unit: "milliseconds" });
  });

  it("rejects percentage points and ratios as incompatible", () => {
    expect(() =>
      normalizeNumericPair({ value: 99, unit: "percent" }, { value: 0.99, unit: "ratio" })
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INVALID",
        safeMessage: "Incompatible units: percent and ratio."
      })
    );
  });

  it("rejects a unit on only one operand", () => {
    expect(() => normalizeNumericPair({ value: 1, unit: "seconds" }, { value: 1000 })).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INVALID",
        safeMessage: "Observed and expected numeric values must declare compatible units."
      })
    );
    expect(() =>
      normalizeNumericPair({ value: 1 }, { value: 1000, unit: "milliseconds" })
    ).toThrowError(
      expect.objectContaining({
        code: "EVIDENCE_INVALID",
        safeMessage: "Observed and expected numeric values must declare compatible units."
      })
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite value %s",
    (value) => {
      expect(() =>
        normalizeNumericPair({ value, unit: "count" }, { value: 1, unit: "count" })
      ).toThrowError(
        expect.objectContaining({
          code: "EVIDENCE_INVALID",
          safeMessage: "Numeric evidence must be finite."
        })
      );
    }
  );
});
