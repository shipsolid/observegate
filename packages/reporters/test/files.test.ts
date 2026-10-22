import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";
import { renderJson, writeReports } from "../src/index.js";

const fileSystem = vi.hoisted(() => ({
  failMarkdownInstall: false,
  failMarkdownRestore: false,
  failBackupCleanup: false,
  abortInstall: undefined as (() => void) | undefined
}));

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
      if (
        fileSystem.failMarkdownRestore &&
        String(oldPath).includes("observability-gate.md.backup-")
      ) {
        fileSystem.failMarkdownRestore = false;
        throw Object.assign(new Error("injected restore failure"), { code: "EACCES" });
      }
      await original.rename(oldPath, newPath);
      if (String(oldPath).includes(".tmp-") && fileSystem.abortInstall !== undefined) {
        const abort = fileSystem.abortInstall;
        fileSystem.abortInstall = undefined;
        abort();
      }
    },
    async rm(path: Parameters<typeof original.rm>[0], options: Parameters<typeof original.rm>[1]) {
      if (fileSystem.failBackupCleanup && String(path).includes(".backup-")) {
        fileSystem.failBackupCleanup = false;
        throw Object.assign(new Error("injected backup cleanup failure"), { code: "EACCES" });
      }
      await original.rm(path, options);
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
    fileSystem.failMarkdownRestore = false;
    fileSystem.failBackupCleanup = false;
    fileSystem.abortInstall = undefined;
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

  it("restores the prior report set when cancelled during installation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-cancel-"));
    await writeFile(join(directory, "observability-gate.json"), "prior");
    const controller = new AbortController();
    fileSystem.abortInstall = () => controller.abort();
    await expect(
      writeReports(await fixture(), {
        directory,
        formats: ["json", "markdown"],
        maximumTotalBytes: 1_000_000,
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(await readFile(join(directory, "observability-gate.json"), "utf8")).toBe("prior");
    expect(await readdir(directory)).toEqual(["observability-gate.json"]);
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

  it("attempts every restoration and temporary cleanup after a rollback failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-reports-"));
    await writeFile(join(directory, "observability-gate.json"), "old json", "utf8");
    await writeFile(join(directory, "observability-gate.md"), "old markdown", "utf8");
    fileSystem.failMarkdownInstall = true;
    fileSystem.failMarkdownRestore = true;

    await expect(
      writeReports(await fixture(), {
        directory,
        formats: ["json", "markdown"],
        maximumTotalBytes: 1_000_000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({
      code: "REPORTING",
      safeMessage: "Report publication failed and the prior report set could not be fully restored."
    });

    expect(await readFile(join(directory, "observability-gate.json"), "utf8")).toBe("old json");
    const names = await readdir(directory);
    expect(names.some((name) => name.startsWith("observability-gate.md.backup-"))).toBe(true);
    expect(names.some((name) => name.includes(".tmp-"))).toBe(false);
  });

  it("reports a retained prior backup after successful publication", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-reports-"));
    await writeFile(join(directory, "observability-gate.json"), "old json", "utf8");
    fileSystem.failBackupCleanup = true;

    await expect(
      writeReports(await fixture(), {
        directory,
        formats: ["json"],
        maximumTotalBytes: 1_000_000,
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({
      code: "REPORTING",
      safeMessage: "Reports were published, but the prior report set could not be removed."
    });

    expect(await readFile(join(directory, "observability-gate.json"), "utf8")).toBe(
      renderJson(await fixture())
    );
    expect(
      (await readdir(directory)).some((name) => name.startsWith("observability-gate.json.backup-"))
    ).toBe(true);
  });
});
