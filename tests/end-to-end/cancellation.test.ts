import { describe, expect, it } from "vitest";
import { runGateScenario } from "./harness.js";

describe("end-to-end cancellation", () => {
  it("never returns pass when cancellation was requested", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled by test"));

    const result = await runGateScenario({
      id: "workload.ready",
      type: "runtime.ready",
      phase: "post_deployment",
      signal: controller.signal,
      value: {
        ready: true,
        availableInstances: 1,
        minimumAvailableInstances: 1,
        unavailableInstances: 0,
        consecutiveSuccessfulSamples: 3,
        requiredConsecutiveSamples: 3
      }
    });

    expect(result.decision).toBe("error");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "CANCELLED")).toBe(true);
  });
});
