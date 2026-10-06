import type { AssertionResult } from "@observability-gate/core";
import { createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

interface MetricValue {
  readonly value: number;
  readonly unit: string;
  readonly samples: number;
  readonly requests?: number;
  readonly releaseId?: string;
}

export interface MetricComparisonInput {
  readonly candidate: MetricValue;
  readonly baseline?: MetricValue;
  readonly minimumCandidateSamples?: number;
  readonly minimumBaselineSamples?: number;
  readonly minimumCandidateRequests?: number;
  readonly minimumBaselineRequests?: number;
  readonly maximumAbsoluteRegression?: number;
  readonly maximumRelativeRegressionPercent?: number;
  readonly normalizedPerRequest?: boolean;
  readonly direction?: "increase_bad" | "decrease_bad";
  readonly window?: string;
}

function result(
  assertion: string,
  status: AssertionResult["status"],
  message: string,
  observed?: unknown,
  expected?: unknown
): AssertionResult {
  return {
    assertion,
    status,
    message,
    ...(observed === undefined ? {} : { observed }),
    ...(expected === undefined ? {} : { expected })
  };
}

export function compareMetricValues(input: MetricComparisonInput): readonly AssertionResult[] {
  if (input.baseline === undefined) {
    return [result("baseline evidence", "inconclusive", "No safe baseline evidence is available")];
  }
  const candidate = input.candidate;
  const baseline = input.baseline;
  if (
    candidate.value < 0 ||
    baseline.value < 0 ||
    !Number.isFinite(candidate.value) ||
    !Number.isFinite(baseline.value)
  ) {
    return [
      result("comparison values", "error", "Comparison values must be finite and non-negative")
    ];
  }
  if (candidate.unit !== baseline.unit) {
    return [
      result(
        "comparison units",
        "error",
        "Candidate and baseline units must match",
        candidate.unit,
        baseline.unit
      )
    ];
  }
  const lowSamples =
    candidate.samples < (input.minimumCandidateSamples ?? 1) ||
    baseline.samples < (input.minimumBaselineSamples ?? 1);
  const lowRequests =
    (input.minimumCandidateRequests !== undefined &&
      (candidate.requests ?? 0) < input.minimumCandidateRequests) ||
    (input.minimumBaselineRequests !== undefined &&
      (baseline.requests ?? 0) < input.minimumBaselineRequests);
  if (lowSamples || lowRequests) {
    return [
      result(
        "comparison samples",
        "inconclusive",
        "Candidate or baseline has insufficient samples",
        {
          candidate: candidate.samples,
          baseline: baseline.samples,
          candidateRequests: candidate.requests ?? 0,
          baselineRequests: baseline.requests ?? 0
        }
      )
    ];
  }
  if (candidate.releaseId !== undefined && candidate.releaseId === baseline.releaseId) {
    return [
      result("release identity", "inconclusive", "Candidate and baseline release IDs must differ")
    ];
  }
  const normalizedCandidate = input.normalizedPerRequest
    ? candidate.value / (candidate.requests ?? 0)
    : candidate.value;
  const normalizedBaseline = input.normalizedPerRequest
    ? baseline.value / (baseline.requests ?? 0)
    : baseline.value;
  if (!Number.isFinite(normalizedCandidate) || !Number.isFinite(normalizedBaseline)) {
    return [
      result(
        "request normalization",
        "inconclusive",
        "Per-request comparison requires non-zero request counts"
      )
    ];
  }
  const direction = input.direction ?? "increase_bad";
  const delta =
    direction === "decrease_bad"
      ? normalizedBaseline - normalizedCandidate
      : normalizedCandidate - normalizedBaseline;
  const regression = Math.max(0, delta);
  const relativeDeltaPercent =
    normalizedBaseline === 0
      ? regression === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : (regression / normalizedBaseline) * 100;
  const observed = {
    candidate: normalizedCandidate,
    baseline: normalizedBaseline,
    delta,
    relativeDeltaPercent,
    unit: candidate.unit,
    window: input.window,
    candidateSamples: candidate.samples,
    baselineSamples: baseline.samples
  };
  const results: AssertionResult[] = [
    result(
      "comparison evidence",
      "passed",
      "Candidate and baseline evidence is comparable",
      observed
    )
  ];
  if (input.maximumAbsoluteRegression !== undefined) {
    results.push(
      result(
        "absolute regression",
        regression <= input.maximumAbsoluteRegression ? "passed" : "failed",
        "Absolute regression is within policy",
        observed,
        input.maximumAbsoluteRegression
      )
    );
  }
  if (input.maximumRelativeRegressionPercent !== undefined) {
    results.push(
      result(
        "relative regression",
        relativeDeltaPercent <= input.maximumRelativeRegressionPercent ? "passed" : "failed",
        "Relative regression is within policy",
        observed,
        input.maximumRelativeRegressionPercent
      )
    );
  }
  return results;
}

export const comparisonMetricGate = createEvidenceGate({
  type: "comparison.metric",
  description: "Compare a candidate metric with a safe baseline.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    return compareMetricValues(value as unknown as MetricComparisonInput);
  }
});

export function comparisons(value: EvidenceRecord): readonly MetricComparisonInput[] {
  return Array.isArray(value.comparisons)
    ? (value.comparisons as unknown as MetricComparisonInput[])
    : [];
}
