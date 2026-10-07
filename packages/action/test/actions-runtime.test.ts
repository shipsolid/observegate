import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubActionsRuntime } from "../src/actions-runtime.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("GitHub Actions workflow runtime", () => {
  it("reads required inputs and rejects missing values", () => {
    process.env.INPUT_CONFIG = " policy.yml ";
    expect(githubActionsRuntime.getInput("config", { required: true })).toBe("policy.yml");
    expect(() => githubActionsRuntime.getInput("phase", { required: true })).toThrow(
      "Input required and not supplied: phase"
    );
  });

  it("writes multiline-safe outputs and the step summary to runner files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-action-"));
    const output = join(directory, "output");
    const summary = join(directory, "summary");
    process.env.GITHUB_OUTPUT = output;
    process.env.GITHUB_STEP_SUMMARY = summary;

    try {
      githubActionsRuntime.setOutput("decision", "pass\nverified");
      await githubActionsRuntime.writeSummary("# Gate\npass\n");

      const outputText = await readFile(output, "utf8");
      expect(outputText).toMatch(/^decision<<observegate_[0-9a-f-]+\npass\nverified\n/mu);
      expect(await readFile(summary, "utf8")).toBe("# Gate\npass\n");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("escapes workflow commands and marks failures", () => {
    delete process.env.GITHUB_OUTPUT;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    githubActionsRuntime.warning("bad%\nvalue");
    githubActionsRuntime.setFailed("failed\r\nvalue");
    expect(stderr).toHaveBeenNthCalledWith(1, "::warning::bad%25%0Avalue\n");
    expect(stderr).toHaveBeenNthCalledWith(2, "::error::failed%0D%0Avalue\n");
    expect(process.exitCode).toBe(1);
  });
});
