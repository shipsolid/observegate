import { describe, expect, it } from "vitest";
import { classifyFreshness } from "../../src/evidence/freshness.js";

const acquiredAt = "2026-10-06T07:30:00.000Z";

describe("classifyFreshness", () => {
  it.each([
    {
      name: "valid",
      observedAt: "2026-10-06T07:29:30.000Z",
      sampleCount: 20,
      minimumSamples: 10,
      expected: "valid"
    },
    {
      name: "missing",
      observedAt: "2026-10-06T07:29:30.000Z",
      sampleCount: 0,
      minimumSamples: 10,
      expected: "missing"
    },
    {
      name: "stale",
      observedAt: "2026-10-06T07:20:00.000Z",
      sampleCount: 20,
      minimumSamples: 10,
      expected: "stale"
    },
    {
      name: "insufficient",
      observedAt: "2026-10-06T07:29:30.000Z",
      sampleCount: 4,
      minimumSamples: 10,
      expected: "insufficient"
    },
    {
      name: "invalid timestamp",
      observedAt: "not-a-date",
      sampleCount: 20,
      minimumSamples: 10,
      expected: "invalid"
    },
    {
      name: "future dated beyond skew",
      observedAt: "2026-10-06T07:30:31.000Z",
      sampleCount: 20,
      minimumSamples: 10,
      expected: "invalid"
    }
  ])("classifies $name evidence as $expected", (input) => {
    expect(
      classifyFreshness({
        observedAt: input.observedAt,
        acquiredAt,
        maximumAgeMs: 120_000,
        maximumFutureSkewMs: 30_000,
        sampleCount: input.sampleCount,
        minimumSamples: input.minimumSamples
      })
    ).toBe(input.expected);
  });

  it("treats age, future skew, and minimum samples as inclusive boundaries", () => {
    expect(
      classifyFreshness({
        observedAt: "2026-10-06T07:28:00.000Z",
        acquiredAt,
        maximumAgeMs: 120_000,
        maximumFutureSkewMs: 30_000,
        sampleCount: 10,
        minimumSamples: 10
      })
    ).toBe("valid");
    expect(
      classifyFreshness({
        observedAt: "2026-10-06T07:30:30.000Z",
        acquiredAt,
        maximumAgeMs: 120_000,
        maximumFutureSkewMs: 30_000,
        sampleCount: 10,
        minimumSamples: 10
      })
    ).toBe("valid");
  });
});
