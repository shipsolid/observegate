import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";
import { writeReports } from "../src/index.js";

async function fixture(): Promise<ExecutionResult> {
  return JSON.parse(
    await readFile(resolve("fixtures/reports/execution-result.json"), "utf8")
  ) as ExecutionResult;
}

describe("writeReports", () => {
  it("atomically writes every requested projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-reports-"));
    const publication = await writeReports(await fixture(), {
      directory,
      formats: ["json", "markdown", "junit", "sarif"],
      maximumTotalBytes: 1_000_000,
      signal: new AbortController().signal
    });

    expect(Object.keys(publication.paths).sort()).toEqual(["json", "junit", "markdown", "sarif"]);
    expect((await readdir(directory)).every((name) => !name.includes(".tmp-"))).toBe(true);
  });

  it("leaves no target or partial file when cancelled before rename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-reports-"));
    const controller = new AbortController();
    controller.abort();

    await expect(
      writeReports(await fixture(), {
        directory,
        formats: ["json"],
        maximumTotalBytes: 1_000_000,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects a report set that exceeds the configured total size", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-reports-"));
    await expect(
      writeReports(await fixture(), {
        directory,
        formats: ["json"],
        maximumTotalBytes: 10,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: "REPORTING" });
    expect(await readdir(directory)).toEqual([]);
  });
});
