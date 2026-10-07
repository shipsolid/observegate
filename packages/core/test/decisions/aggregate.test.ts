import { describe, expect, it } from "vitest";
import {
  aggregateDecision,
  calculateEvidenceCoverage,
  createGateResult,
  type GateResult,
  type GateStatus
} from "../../src/index.js";

function gate(
  id: string,
  status: GateStatus,
  enforcement: GateResult["enforcement"] = "blocking"
): GateResult {
  return createGateResult({
    id,
    name: id,
    type: "test.gate",
    phase: "post_deployment",
    enforcement,
    status,
    startedAt: "2026-10-06T07:30:00.000Z",
    completedAt: "2026-10-06T07:30:01.000Z",
    durationMs: 1000,
    assertions: [],
    evidence: [],
    diagnostics: []
  });
}

describe("aggregateDecision", () => {
  it.each([
    {
      name: "all blocking gates pass",
      gates: [gate("one", "passed"), gate("two", "passed")],
      decision: "pass"
    },
    {
      name: "an advisory gate warns",
      gates: [gate("one", "passed"), gate("advice", "warned", "advisory")],
      decision: "warn"
    },
    {
      name: "a configured optional skip warns",
      gates: [gate("one", "passed"), gate("optional", "skipped", "advisory")],
      decision: "warn"
    },
    {
      name: "a blocking assertion fails",
      gates: [gate("one", "passed"), gate("failed", "failed")],
      decision: "fail"
    },
    {
      name: "blocking evidence is inconclusive",
      gates: [gate("one", "passed"), gate("unknown", "inconclusive")],
      decision: "inconclusive"
    },
    {
      name: "a blocking provider errors",
      gates: [gate("failed", "failed"), gate("provider", "error")],
      decision: "error"
    }
  ] as const)("returns $decision when $name", ({ gates, decision }) => {
    const summary = aggregateDecision({
      gates,
      policy: { minimumEvidenceCoveragePercent: 90, warnOnSkipped: true },
      evidenceRequirements: []
    });

    expect(summary.decision).toBe(decision);
  });

  it("fails when evidence coverage is below the configured minimum", () => {
    const summary = aggregateDecision({
      gates: [gate("one", "passed"), gate("two", "passed")],
      policy: { minimumEvidenceCoveragePercent: 90, warnOnSkipped: false },
      evidenceRequirements: [
        { gateId: "one", requirementId: "metrics", satisfied: true },
        { gateId: "two", requirementId: "logs", satisfied: false }
      ]
    });

    expect(summary.evidenceCoveragePercent).toBe(50);
    expect(summary.decision).toBe("fail");
    expect(summary.blockingReasons[0]?.gateId).toBe("evidence-coverage");
  });

  it("uses severity precedence regardless of completion order", () => {
    const first = aggregateDecision({
      gates: [gate("error", "error"), gate("failed", "failed"), gate("unknown", "inconclusive")],
      configurationOrder: ["failed", "unknown", "error"],
      policy: { minimumEvidenceCoveragePercent: 90, warnOnSkipped: true },
      evidenceRequirements: []
    });
    const second = aggregateDecision({
      gates: [gate("unknown", "inconclusive"), gate("error", "error"), gate("failed", "failed")],
      configurationOrder: ["failed", "unknown", "error"],
      policy: { minimumEvidenceCoveragePercent: 90, warnOnSkipped: true },
      evidenceRequirements: []
    });

    expect(first.decision).toBe("error");
    expect(second.decision).toBe("error");
    expect(first.gates.map((result) => result.id)).toEqual(["failed", "unknown", "error"]);
    expect(second.gates.map((result) => result.id)).toEqual(["failed", "unknown", "error"]);
    expect(first.blockingReasons.map((reason) => reason.gateId)).toEqual([
      "failed",
      "unknown",
      "error"
    ]);
  });

  it("returns stable counts and blocking reason contracts", () => {
    const failed = createGateResult({
      ...gate("failed", "failed"),
      assertions: [
        {
          assertion: "ready",
          status: "failed",
          observed: false,
          expected: true,
          message: "Workload is not ready."
        }
      ]
    });
    const errored = createGateResult({
      ...gate("errored", "error"),
      diagnostics: [{ code: "PROVIDER_ERROR", message: "Provider unavailable.", retryable: true }]
    });
    const summary = aggregateDecision({
      gates: [
        gate("passed", "passed"),
        gate("warned", "warned", "advisory"),
        failed,
        gate("unknown", "inconclusive"),
        errored,
        gate("skipped", "skipped", "advisory")
      ],
      policy: { minimumEvidenceCoveragePercent: 100, warnOnSkipped: true },
      evidenceRequirements: [{ gateId: "passed", requirementId: "metrics", satisfied: false }]
    });

    expect(summary.counts).toEqual({
      passed: 1,
      warned: 1,
      failed: 1,
      inconclusive: 1,
      error: 1,
      skipped: 1
    });
    expect(summary.blockingReasons).toEqual([
      {
        gateId: "evidence-coverage",
        status: "failed",
        message: "Evidence coverage 0% is below the required 100%."
      },
      { gateId: "failed", status: "failed", message: "Workload is not ready." },
      {
        gateId: "unknown",
        status: "inconclusive",
        message: "Blocking gate unknown ended with status inconclusive."
      },
      { gateId: "errored", status: "error", message: "Provider unavailable." }
    ]);
  });

  it("does not let advisory failures block or advisory skips warn when disabled", () => {
    const summary = aggregateDecision({
      gates: [
        gate("passed", "passed"),
        gate("advisory-failed", "failed", "advisory"),
        gate("advisory-skipped", "skipped", "advisory")
      ],
      policy: { minimumEvidenceCoveragePercent: 0, warnOnSkipped: false },
      evidenceRequirements: []
    });

    expect(summary.decision).toBe("warn");
    expect(summary.blockingReasons).toEqual([]);

    const skippedOnly = aggregateDecision({
      gates: [gate("passed", "passed"), gate("advisory-skipped", "skipped", "advisory")],
      policy: { minimumEvidenceCoveragePercent: 0, warnOnSkipped: false },
      evidenceRequirements: []
    });
    expect(skippedOnly.decision).toBe("pass");
  });
});

describe("calculateEvidenceCoverage", () => {
  it("counts each applicable requirement once and excludes skipped gates", () => {
    const coverage = calculateEvidenceCoverage(
      [gate("shared-one", "passed"), gate("shared-two", "passed"), gate("skip", "skipped")],
      [
        { gateId: "shared-one", requirementId: "metrics", satisfied: true },
        { gateId: "shared-one", requirementId: "metrics", satisfied: true },
        { gateId: "shared-two", requirementId: "metrics", satisfied: true },
        { gateId: "skip", requirementId: "logs", satisfied: false }
      ]
    );

    expect(coverage).toEqual({ satisfied: 2, total: 2, percent: 100 });
  });
});
