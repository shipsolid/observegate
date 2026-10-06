import { describe, expect, it } from "vitest";
import { normalizeNumericPair } from "../../src/assertions/units.js";

describe("normalizeNumericPair", () => {
  it("normalizes seconds and milliseconds to the same duration family", () => {
    expect(
      normalizeNumericPair({ value: 750, unit: "milliseconds" }, { value: 0.75, unit: "seconds" })
    ).toEqual({ observed: 750, expected: 750, unit: "milliseconds" });
  });

  it("rejects percentage points and ratios as incompatible", () => {
    expect(() =>
      normalizeNumericPair({ value: 99, unit: "percent" }, { value: 0.99, unit: "ratio" })
    ).toThrowError(expect.objectContaining({ code: "EVIDENCE_INVALID" }));
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects non-finite value %s",
    (value) => {
      expect(() =>
        normalizeNumericPair({ value, unit: "count" }, { value: 1, unit: "count" })
      ).toThrowError(expect.objectContaining({ code: "EVIDENCE_INVALID" }));
    }
  );
});
