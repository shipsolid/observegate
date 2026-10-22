import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../packages/cli/src/main.js";
import { runAction } from "../../packages/action/src/main.js";

describe("offline quickstart through shipped compositions", () => {
  it.each([false, true])(
    "runs CLI and Action with a deterministic expected failure=%s",
    async (failure) => {
      const workspace = await mkdtemp(join(tmpdir(), "observegate-quickstart-"));
      try {
        const sample = await readFile("examples/offline.yml", "utf8");
        await mkdir(join(workspace, "examples/evidence"), { recursive: true });
        await writeFile(
          join(workspace, "policy.yml"),
          failure ? sample.replaceAll("demo-release-v1", "demo-release-v2") : sample
        );
        await writeFile(
          join(workspace, "examples/evidence/synthetic.json"),
          await readFile("examples/evidence/synthetic.json")
        );
        let stdout = "";
        const dependencies = {
          workspaceRoot: workspace,
          environment: {},
          output: {
            stdout: (text: string) => {
              stdout += text;
            },
            stderr: () => undefined
          }
        };
        expect(await runCli(["validate", "--config", "policy.yml"], dependencies)).toBe(0);
        expect(
          await runCli(
            ["plan", "--config", "policy.yml", "--phase", "post_deployment"],
            dependencies
          )
        ).toBe(0);
        expect(
          await runCli(
            ["run", "--config", "policy.yml", "--phase", "pre_deployment", "--json"],
            dependencies
          )
        ).toBe(0);
        stdout = "";
        const directory = join(workspace, "reports");
        expect(
          await runCli(
            [
              "run",
              "--config",
              "policy.yml",
              "--phase",
              "post_deployment",
              "--output-directory",
              directory,
              "--events",
              "events.jsonl",
              "--json"
            ],
            dependencies
          )
        ).toBe(failure ? 1 : 0);
        expect(JSON.parse(stdout).decision).toBe(failure ? "fail" : "pass");
        const events = (await readFile(join(workspace, "events.jsonl"), "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as { name: string });
        for (const name of [
          "configuration_loaded",
          "execution_planned",
          "evidence_acquired",
          "gate_completed",
          "decision_completed",
          "report_written"
        ])
          expect(
            events.some((event) => event.name === name),
            name
          ).toBe(true);
        for (const name of [
          "observability-gate.json",
          "observability-gate.md",
          "observability-gate.xml",
          "observability-gate.sarif"
        ])
          expect((await readFile(join(directory, name))).length).toBeGreaterThan(0);
        const outputs = new Map<string, unknown>(),
          failures: string[] = [];
        const inputs: Record<string, string> = {
          config: "policy.yml",
          phase: "post_deployment",
          "output-directory": join(workspace, "action-reports")
        };
        await runAction({
          workspaceRoot: workspace,
          environment: {},
          runtime: {
            getInput: (name) => inputs[name] ?? "",
            setOutput: (name, value) => {
              outputs.set(name, value);
            },
            setFailed: (message) => {
              failures.push(message);
            },
            warning: () => undefined,
            writeSummary: async () => undefined
          }
        });
        expect(outputs.get("decision")).toBe(failure ? "fail" : "pass");
        expect(failures.length).toBe(failure ? 1 : 0);
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  );
});
