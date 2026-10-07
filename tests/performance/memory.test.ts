import { describe, expect, it } from "vitest";
import { runMemoryScenario } from "./fixtures/memory-scenario.js";

describe("execution memory budget", () => {
  it("retains bounded memory for maximum evidence and a near-limit 200-gate report", () => {
    const metrics = runMemoryScenario();

    expect(metrics.gateCount).toBe(200);
    expect(metrics.responseBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(metrics.reportBytes).toBeGreaterThan(6 * 1024 * 1024);
    expect(metrics.reportBytes).toBeLessThanOrEqual(10 * 1024 * 1024);
    expect(metrics.responseBytes + metrics.reportBytes).toBeLessThanOrEqual(12 * 1024 * 1024);
    expect(metrics.retainedHeapBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});
