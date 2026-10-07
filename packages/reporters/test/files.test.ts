import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";
import { renderJson, writeReports } from "../src/index.js";

const fileSystem = vi.hoisted(() => ({ failMarkdownInstall: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    async rename(
      oldPath: Parameters<typeof original.rename>[0],
      newPath: Parameters<typeof original.rename>[1]
    ) {
      if (
        fileSystem.failMarkdownInstall &&
        String(oldPath).includes("observability-gate.md.tmp-")
      ) {
        fileSystem.failMarkdownInstall = false;
        throw Object.assign(new Error("injected rename failure"), { code: "EACCES" });
      }
      await original.rename(oldPath, newPath);
    }
  };
});

async function fixture(): Promise<ExecutionResult> {
  return JSON.parse(
    await readFile(resolve("fixtures/reports/execution-result.json"), "utf8")
  ) as ExecutionResult;
}

describe("writeReports", () => {
  beforeEach(() => {
    fileSystem.failMarkdownInstall = false;
  });

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
    const result = await fixture();
    await expect(
      writeReports(result, {
        directory,
        formats: ["json", "markdown"],
        maximumTotalBytes: Buffer.byteLength(renderJson(result)),
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: "REPORTING" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("restores the prior report set when a later install rename fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-reports-"));
    await writeFile(join(directory, "observability-gate.json"), "old json", "utf8");
    await writeFile(join(directory, "observability-gate.md"), "old markdown", "utf8");
    fileSystem.failMarkdownInstall = true;

    await expect(
      writeReports(await fixture(), {
        directory,
        formats: ["json", "markdown"],
        maximumTotalBytes: 1_000_000,
        signal: new AbortController().signal
      })
    ).rejects.toThrow("injected rename failure");

    expect(await readFile(join(directory, "observability-gate.json"), "utf8")).toBe("old json");
    expect(await readFile(join(directory, "observability-gate.md"), "utf8")).toBe("old markdown");
    expect((await readdir(directory)).sort()).toEqual([
      "observability-gate.json",
      "observability-gate.md"
    ]);
  });
});
