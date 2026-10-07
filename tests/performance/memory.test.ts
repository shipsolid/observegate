import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MemoryScenarioMetrics } from "./fixtures/memory-scenario.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("execution memory budget", () => {
  it("enforces configured production boundaries for provider data and a 200-gate report", async (context) => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-memory-"));
    directories.push(directory);
    let metrics: MemoryScenarioMetrics;
    try {
      const stdout = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "tests/performance/fixtures/memory-child.ts", directory],
        { cwd: process.cwd(), encoding: "utf8", maxBuffer: 1024 * 1024 }
      );
      metrics = JSON.parse(stdout) as MemoryScenarioMetrics;
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EPERM"
      )) {
        throw error;
      }
      context.skip("isolated child processes are unavailable in this execution environment");
      return;
    }

    expect(metrics.gateCount).toBe(200);
    expect(metrics.responseBytes).toBe(metrics.maximumProviderResponseBytes);
    expect(metrics.reportBytes).toBe(metrics.maximumReportBytes);
    expect(metrics.responseBytes + metrics.reportBytes).toBe(35 * 1024 * 1024);
    expect(metrics.providerRejectedOverLimit).toBe(true);
    expect(metrics.reporterRejectedOverLimit).toBe(true);
    // Covers the normalized 200-gate object graph and formatter bookkeeping after transient strings are collected.
    const retainedOverheadBytes = 8 * 1024 * 1024;
    expect(metrics.retainedHeapBytes).toBeLessThanOrEqual(
      metrics.responseBytes + metrics.reportBytes + retainedOverheadBytes
    );
    // Allows one bounded projection plus filesystem/runtime buffers above the configured input + output ceiling.
    const peakOverheadBytes = 32 * 1024 * 1024;
    expect(metrics.peakRssGrowthBytes).toBeLessThanOrEqual(
      metrics.responseBytes + metrics.reportBytes + peakOverheadBytes
    );
  }, 15_000);
});
