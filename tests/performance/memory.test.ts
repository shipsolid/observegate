import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMemoryScenario } from "./fixtures/memory-scenario.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("execution memory budget", () => {
  it("enforces configured production boundaries for provider data and a 200-gate report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-memory-"));
    directories.push(directory);
    const metrics = await runMemoryScenario(directory);

    expect(metrics.gateCount).toBe(200);
    expect(metrics.responseBytes).toBe(metrics.maximumProviderResponseBytes);
    expect(metrics.reportBytes).toBe(metrics.maximumReportBytes);
    expect(metrics.responseBytes + metrics.reportBytes).toBe(35 * 1024 * 1024);
    expect(metrics.providerRejectedOverLimit).toBe(true);
    expect(metrics.reporterRejectedOverLimit).toBe(true);
    expect(metrics.retainedHeapBytes).toBeLessThanOrEqual(192 * 1024 * 1024);
  });
});
