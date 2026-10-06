import { describe, expect, it } from "vitest";
import { compareMetricValues } from "../../../src/index.js";

const base = {
  candidate: { value: 12, unit: "seconds", samples: 300, requests: 300, releaseId: "candidate" },
  baseline: { value: 10, unit: "seconds", samples: 600, requests: 600, releaseId: "baseline" },
  minimumCandidateSamples: 200,
  minimumBaselineSamples: 500,
  maximumAbsoluteRegression: 3,
  maximumRelativeRegressionPercent: 25,
  direction: "increase_bad" as const,
  window: "5m"
};

describe("metric comparison math", () => {
  it("fails absolute and relative limits independently", () => {
    expect(
      compareMetricValues({
        ...base,
        maximumAbsoluteRegression: 1,
        maximumRelativeRegressionPercent: 25
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertion: "absolute regression", status: "failed" }),
        expect.objectContaining({ assertion: "relative regression", status: "passed" })
      ])
    );
    expect(
      compareMetricValues({
        ...base,
        maximumAbsoluteRegression: 3,
        maximumRelativeRegressionPercent: 10
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertion: "absolute regression", status: "passed" }),
        expect.objectContaining({ assertion: "relative regression", status: "failed" })
      ])
    );
  });

  it("passes both configured limits", () => {
    expect(compareMetricValues(base).every((result) => result.status === "passed")).toBe(true);
  });

  it("handles a zero baseline deterministically", () => {
    const results = compareMetricValues({
      ...base,
      candidate: { ...base.candidate, value: 1 },
      baseline: { ...base.baseline, value: 0 }
    });
    expect(results.find((result) => result.assertion === "relative regression")).toMatchObject({
      status: "failed",
      observed: expect.objectContaining({ relativeDeltaPercent: Number.POSITIVE_INFINITY })
    });
  });

  it.each([
    ["negative value", { ...base, candidate: { ...base.candidate, value: -1 } }],
    ["mismatched units", { ...base, candidate: { ...base.candidate, unit: "bytes" } }]
  ])("returns an error for %s", (_case, input) => {
    expect(compareMetricValues(input).some((result) => result.status === "error")).toBe(true);
  });

  it("normalizes both values per request", () => {
    const results = compareMetricValues({
      ...base,
      candidate: { ...base.candidate, value: 300, requests: 300 },
      baseline: { ...base.baseline, value: 600, requests: 600 },
      normalizedPerRequest: true
    });
    expect(results.every((result) => result.status === "passed")).toBe(true);
  });

  it("returns inconclusive for low candidate or baseline sample counts", () => {
    expect(
      compareMetricValues({ ...base, candidate: { ...base.candidate, samples: 199 } }).some(
        (result) => result.status === "inconclusive"
      )
    ).toBe(true);
    expect(
      compareMetricValues({ ...base, baseline: { ...base.baseline, samples: 499 } }).some(
        (result) => result.status === "inconclusive"
      )
    ).toBe(true);
  });

  it("returns inconclusive for 199 candidate requests when 200 are required", () => {
    expect(
      compareMetricValues({
        ...base,
        candidate: { ...base.candidate, requests: 199 },
        minimumCandidateRequests: 200
      }).some((result) => result.status === "inconclusive")
    ).toBe(true);
  });

  it("returns inconclusive when the baseline is missing", () => {
    expect(
      compareMetricValues({ ...base, baseline: undefined }).some(
        (result) => result.status === "inconclusive"
      )
    ).toBe(true);
  });
});
