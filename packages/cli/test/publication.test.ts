import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";
import { runCommand } from "../src/commands/run.js";

const result: ExecutionResult = {
  decision: "pass",
  phase: "pre_deployment",
  target: { id: "test", runtimeType: "generic", provider: "test" },
  release: { candidateId: "release", deploymentId: "deployment" },
  startedAt: "2026-10-22T00:00:00Z",
  completedAt: "2026-10-22T00:00:01Z",
  evidenceCoveragePercent: 100,
  gates: [],
  diagnostics: [],
  links: {}
};

describe("CLI artifact publication", () => {
  it.each([false, true])(
    "uses configured formats and directory with explicit override=%s",
    async (override) => {
      const directory = await mkdtemp(join(tmpdir(), "observegate-publication-"));
      const configured = join(directory, "configured");
      const explicit = join(directory, "explicit");
      const stdout: string[] = [];
      try {
        const code = await runCommand(
          {
            config: "policy.yml",
            phase: "pre_deployment",
            json: true,
            ...(override ? { outputDirectory: explicit } : {})
          },
          {
            workspaceRoot: process.cwd(),
            environment: {},
            catalog: {},
            signal: new AbortController().signal,
            output: { stdout: (value) => stdout.push(value), stderr: () => undefined },
            service: {
              run: async () => result,
              plan: async () => {
                throw new Error("unused");
              },
              validate: async () => [],
              publicationOptions: async () => ({
                github: { checkRun: false, stepSummary: false, pullRequestComment: false },
                directory: configured,
                formats: ["junit"]
              })
            }
          }
        );
        expect(code).toBe(0);
        const actual = override ? explicit : configured;
        expect(await readdir(actual)).toEqual(["observability-gate.xml"]);
        expect(await readFile(join(actual, "observability-gate.xml"), "utf8")).toContain(
          "<testsuite"
        );
        expect(JSON.parse(stdout.join(""))).toMatchObject({ decision: "pass" });
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
});
