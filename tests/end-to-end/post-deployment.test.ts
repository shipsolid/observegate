import { describe, expect, it } from "vitest";
import { runGateScenario } from "./harness.js";

describe("post-deployment release scenarios", () => {
  it("passes a stable ready workload", async () => {
    const result = await runGateScenario({
      id: "workload.ready",
      type: "runtime.ready",
      phase: "post_deployment",
      value: {
        ready: true,
        availableInstances: 3,
        minimumAvailableInstances: 2,
        unavailableInstances: 0,
        consecutiveSuccessfulSamples: 3,
        requiredConsecutiveSamples: 3
      }
    });

    expect(result.decision).toBe("pass");
  });

  it.each([
    ["wrong release", "workload.release", "runtime.release_identity"],
    ["absent signal", "telemetry.metrics-presence", "telemetry.presence"],
    ["stale signal", "telemetry.freshness", "telemetry.freshness"],
    ["broken correlation", "telemetry.trace-log-correlation", "telemetry.correlation"],
    ["high error rate", "release.error-rate", "metric.threshold"],
    ["latency regression", "regression.latency", "comparison.metric"],
    ["burn rate", "release.burn-rate", "grafana.burn_rate"],
    ["synthetic failure", "release.synthetic", "synthetic.result"],
    ["Kubernetes rollout failure", "kubernetes.rollout", "kubernetes.rollout_status"],
    [
      "Container Apps revision failure",
      "container-apps.revision",
      "azure_container_apps.revision_status"
    ],
    ["VM release marker mismatch", "vm.release-marker", "vm.release_marker"]
  ])("blocks on %s", async (_name, id, type) => {
    const value =
      type === "synthetic.result"
        ? { requiredTests: ["checkout"], tests: [] }
        : type === "comparison.metric"
          ? {
              candidate: { value: 2, unit: "ratio", samples: 100 },
              baseline: { value: 1, unit: "ratio", samples: 100 },
              maximumRelativeRegressionPercent: 10
            }
          : {};
    const result = await runGateScenario({
      id,
      type,
      phase: "post_deployment",
      value
    });

    expect(["fail", "inconclusive"]).toContain(result.decision);
    expect(result.gates[0]?.status).not.toBe("passed");
  });

  it.each([
    ["insufficient candidate traffic", "regression.low-traffic"],
    ["missing baseline", "regression.missing-baseline"]
  ])("returns inconclusive for %s", async (_name, id) => {
    const value =
      id === "regression.missing-baseline"
        ? { candidate: { value: 1, unit: "ratio", samples: 10 } }
        : {
            candidate: { value: 1, unit: "ratio", samples: 1 },
            baseline: { value: 1, unit: "ratio", samples: 1 },
            minimumCandidateSamples: 10,
            minimumBaselineSamples: 10
          };
    const result = await runGateScenario({
      id,
      type: "comparison.metric",
      phase: "post_deployment",
      value
    });

    expect(result.decision).toBe("inconclusive");
    expect(result.gates[0]?.status).toBe("inconclusive");
  });
});
