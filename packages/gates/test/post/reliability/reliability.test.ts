import { describe, expect, it } from "vitest";
import { EvidenceStore, type Evidence } from "@observability-gate/core";
import { GateCatalog, registerPostReliabilityGates, type GateContext } from "../../../src/index.js";

const types = [
  "comparison.metric",
  "comparison.multi_metric",
  "comparison.trace_metrics",
  "comparison.telemetry_volume",
  "grafana.slo_status",
  "grafana.error_budget",
  "grafana.burn_rate",
  "grafana.alert_state",
  "dependency.health",
  "synthetic.result",
  "http.assertion",
  "metric.threshold"
] as const;

const context: GateContext = {
  phase: "post_deployment",
  targetId: "prod-checkout",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date("2026-10-06T08:10:00Z"),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};

function assertionsFor(type: string, value: Readonly<Record<string, unknown>>) {
  const catalog = registerPostReliabilityGates(new GateCatalog());
  const evidence: Evidence<unknown> = {
    id: "e",
    kind: type,
    state: "valid",
    source: { provider: "fixture", capability: type },
    target: context.targetId,
    acquiredAt: context.clock().toISOString(),
    value,
    diagnostics: []
  };
  const definition = type === "comparison.telemetry_volume" ? { enforcement: "advisory" } : {};
  return catalog.require(type, "post_deployment", definition).evaluate([evidence], context);
}

describe("post-deployment reliability catalogue", () => {
  it("resolves every regression and reliability reference type", () => {
    const catalog = registerPostReliabilityGates(new GateCatalog());
    for (const type of types) {
      const definition = type === "comparison.telemetry_volume" ? { enforcement: "advisory" } : {};
      expect(catalog.require(type, "post_deployment", definition).metadata.type).toBe(type);
    }
  });

  it("evaluates required dependencies independently", () => {
    expect(
      assertionsFor("dependency.health", {
        dependencies: [
          { name: "payments", required: true, healthy: true },
          { name: "inventory", required: true, healthy: false }
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertion: "payments", status: "passed" }),
        expect.objectContaining({ assertion: "inventory", status: "failed" })
      ])
    );
  });

  it("normalizes multi-metric and telemetry-volume comparisons per request", () => {
    const comparison = {
      candidate: {
        value: 300,
        unit: "bytes",
        samples: 300,
        requests: 300,
        releaseId: "candidate"
      },
      baseline: {
        value: 600,
        unit: "bytes",
        samples: 600,
        requests: 600,
        releaseId: "baseline"
      },
      minimumCandidateSamples: 200,
      minimumBaselineSamples: 500,
      maximumRelativeRegressionPercent: 20
    };
    expect(
      assertionsFor("comparison.multi_metric", { comparisons: [comparison] }).every(
        (result) => result.status === "passed"
      )
    ).toBe(true);
    expect(
      assertionsFor("comparison.telemetry_volume", { comparisons: [comparison] }).every(
        (result) => result.status === "passed"
      )
    ).toBe(true);
  });

  it("compares only expected dependency peers", () => {
    const comparison = {
      candidate: { value: 0.11, unit: "seconds", samples: 300, releaseId: "candidate" },
      baseline: { value: 0.1, unit: "seconds", samples: 600, releaseId: "baseline" },
      maximumRelativeRegressionPercent: 25
    };
    expect(
      assertionsFor("comparison.trace_metrics", {
        expectedDependencies: ["payments"],
        dependencies: [
          { name: "payments", comparison },
          {
            name: "unknown-peer",
            comparison: {
              ...comparison,
              candidate: { ...comparison.candidate, value: 10 }
            }
          }
        ]
      }).every((result) => result.status === "passed")
    ).toBe(true);
  });

  it("requires named synthetic tests, durations, pass rate, and release identity", () => {
    const results = assertionsFor("synthetic.result", {
      requiredTests: ["health", "journey"],
      tests: [
        {
          name: "health",
          passed: true,
          durationMs: 100,
          maximumDurationMs: 2000,
          releaseHeader: "abc",
          expectedReleaseHeader: "abc"
        },
        {
          name: "journey",
          passed: false,
          durationMs: 11000,
          maximumDurationMs: 10000,
          releaseHeader: "old",
          expectedReleaseHeader: "abc"
        }
      ]
    });
    expect(results.filter((result) => result.status === "failed").length).toBeGreaterThanOrEqual(3);
  });

  it("evaluates guarded HTTP probe evidence", () => {
    expect(
      assertionsFor("http.assertion", {
        status: 200,
        expectedStatuses: [200],
        durationMs: 100,
        maximumDurationMs: 2000,
        headersMatch: true,
        jsonMatches: true
      }).every((result) => result.status === "passed")
    ).toBe(true);
  });

  it("checks release-period consumed budget and alerts", () => {
    expect(
      assertionsFor("grafana.error_budget", {
        fresh: true,
        remainingPercent: 30,
        minimumRemainingPercent: 20,
        consumedDuringReleasePercent: 6,
        maximumConsumedDuringReleasePercent: 5
      }).some((result) => result.status === "failed")
    ).toBe(true);
    expect(
      assertionsFor("grafana.alert_state", {
        fresh: true,
        alerts: [{ state: "firing", startedAfterDeployment: true }]
      }).some((result) => result.status === "failed")
    ).toBe(true);
    expect(
      assertionsFor("grafana.alert_state", {
        fresh: true,
        candidatePeriodOnly: true,
        alerts: [{ state: "firing", startedAfterDeployment: false }]
      }).every((result) => result.status === "passed")
    ).toBe(true);
  });

  it("keeps telemetry volume comparison advisory unless explicitly overridden", () => {
    const catalog = registerPostReliabilityGates(new GateCatalog());
    expect(() =>
      catalog.require("comparison.telemetry_volume", "post_deployment", { enforcement: "blocking" })
    ).toThrow();
    expect(() =>
      catalog.require("comparison.telemetry_volume", "post_deployment", {
        enforcement: "blocking",
        allowBlockingBudget: true
      })
    ).not.toThrow();
  });
});
