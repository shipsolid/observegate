import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  Diagnostic,
  ExecutionPlan,
  ExecutionRequest,
  ExecutionResult,
  GateCatalogMetadata
} from "@observability-gate/core";
import { runCli } from "../src/main.js";

const plan: ExecutionPlan = {
  phase: "pre_deployment",
  targetId: "production",
  runtimeType: "kubernetes",
  gates: [
    {
      index: 0,
      id: "readiness.policy",
      name: "Policy readiness",
      type: "policy.self_check",
      enforcement: "blocking",
      applicability: "applicable",
      timeoutMs: 1_000,
      providerRequirements: [{ provider: "metrics", capability: "query", required: true }],
      definition: { query: 'up{token="secret-token"}' }
    }
  ],
  requiredProviders: [{ provider: "metrics", capability: "query", required: true }],
  deadlineMs: 10_000
};

function execution(decision: ExecutionResult["decision"] = "pass"): ExecutionResult {
  return {
    decision,
    phase: "pre_deployment",
    target: { id: "production", runtimeType: "kubernetes", provider: "runtime" },
    release: { candidateId: "release-1", deploymentId: "deployment-1" },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    evidenceCoveragePercent: 100,
    gates: [],
    diagnostics: [],
    links: {}
  };
}

function harness(
  options: {
    readonly diagnostics?: readonly Diagnostic[];
    readonly decision?: ExecutionResult["decision"];
    readonly signal?: AbortSignal;
    readonly reportLimit?: number;
  } = {}
) {
  let stdout = "";
  let stderr = "";
  const requests: ExecutionRequest[] = [];
  const reportLimitRequests: ExecutionRequest[] = [];
  const service = {
    async validate(request: ExecutionRequest) {
      requests.push(request);
      return options.diagnostics ?? [];
    },
    async plan(request: ExecutionRequest) {
      requests.push(request);
      return plan;
    },
    async run(request: ExecutionRequest) {
      requests.push(request);
      return execution(options.decision);
    },
    async maximumReportBytes(request: ExecutionRequest) {
      reportLimitRequests.push(request);
      return options.reportLimit ?? 25 * 1024 * 1024;
    }
  };
  const catalog: GateCatalogMetadata = {
    "policy.self_check": {
      type: "policy.self_check",
      description: "Validates the policy.",
      supportedPhases: ["pre_deployment"],
      providerRequirements: [],
      conditionKeys: [],
      assertionSchema: "normalized-evidence/v1",
      supportsRemediation: true
    }
  };
  return {
    dependencies: {
      service,
      catalog,
      output: {
        stdout: (text: string) => {
          stdout += text;
        },
        stderr: (text: string) => {
          stderr += text;
        }
      },
      workspaceRoot: "/workspace",
      environment: {},
      ...(options.signal === undefined ? {} : { signal: options.signal })
    },
    requests,
    reportLimitRequests,
    stdout: () => stdout,
    stderr: () => stderr
  };
}

describe("observability-gate CLI", () => {
  it("shows help and handles unknown commands and missing config", async () => {
    const help = harness();
    expect(await runCli(["--help"], help.dependencies)).toBe(0);
    expect(help.stdout()).toContain("validate");

    const unknown = harness();
    expect(await runCli(["unknown"], unknown.dependencies)).toBe(1);
    expect(unknown.stderr()).toContain("unknown command");

    const missing = harness();
    expect(await runCli(["validate"], missing.dependencies)).toBe(1);
    expect(missing.stderr()).toContain("required option '--config <path>'");
  });

  it("rejects unknown options and missing option values without executing a command", async () => {
    const unknown = harness();
    expect(await runCli(["catalog", "--write"], unknown.dependencies)).toBe(1);
    expect(unknown.stderr()).toContain("unknown option '--write'");
    expect(unknown.requests).toHaveLength(0);

    const missingValue = harness();
    expect(await runCli(["validate", "--config"], missingValue.dependencies)).toBe(1);
    expect(missingValue.stderr()).toContain("argument missing");
    expect(missingValue.requests).toHaveLength(0);
  });

  it("validates successfully and reports validation diagnostics", async () => {
    const valid = harness();
    expect(await runCli(["validate", "--config", "policy.yml"], valid.dependencies)).toBe(0);
    expect(valid.stdout()).toBe("Configuration is valid.\n");

    const invalid = harness({
      diagnostics: [{ code: "CONFIG_SCHEMA", message: "Invalid policy.", retryable: false }]
    });
    expect(await runCli(["validate", "--config", "policy.yml"], invalid.dependencies)).toBe(3);
    expect(invalid.stderr()).toContain("CONFIG_SCHEMA");
  });

  it("prints a credential-free plan", async () => {
    const value = harness();
    expect(
      await runCli(
        ["plan", "--config", "policy.yml", "--phase", "pre_deployment", "--json"],
        value.dependencies
      )
    ).toBe(0);
    expect(value.stdout()).toContain('"targetId":"production"');
    expect(value.stdout()).not.toContain("secret-token");
    expect(value.stdout()).not.toContain("up{");
  });

  it.each([
    ["pass", 0],
    ["warn", 0],
    ["fail", 1],
    ["inconclusive", 2],
    ["error", 3]
  ] as const)("maps %s to exit code %i", async (decision, expected) => {
    const value = harness({ decision });
    const code = await runCli(
      ["run", "--config", "policy.yml", "--phase", "post_deployment", "--target", "blue", "--json"],
      value.dependencies
    );
    expect(code).toBe(expected);
    expect(value.requests[0]?.phase).toBe("post_deployment");
    expect(value.requests[0]?.targetOverride).toBe("blue");
    expect(JSON.parse(value.stdout())).toMatchObject({ decision, targetId: "production" });
  });

  it("enforces the report limit resolved from the policy", async () => {
    const directory = await mkdtemp(join(tmpdir(), "observegate-cli-report-"));
    try {
      const value = harness({ reportLimit: 1 });
      expect(
        await runCli(
          [
            "run",
            "--config",
            "policy.yml",
            "--phase",
            "post_deployment",
            "--json",
            "--output-directory",
            directory
          ],
          value.dependencies
        )
      ).toBe(3);
      expect(value.reportLimitRequests).toHaveLength(1);
      expect(value.reportLimitRequests[0]?.configPath).toBe("policy.yml");
      expect(value.stderr()).toContain("REPORTING");
      expect(JSON.parse(value.stdout()).decision).toBe("error");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("explains known types and configured gate IDs and rejects unknown gates", async () => {
    const known = harness();
    expect(await runCli(["explain", "policy.self_check"], known.dependencies)).toBe(0);
    expect(known.stdout()).toContain("Validates the policy.");
    expect(known.stdout()).toContain("Assertions:");
    expect(known.stdout()).toContain("Evidence:");

    const configured = harness();
    expect(
      await runCli(
        ["explain", "readiness.policy", "--config", "policy.yml"],
        configured.dependencies
      )
    ).toBe(0);
    expect(configured.stdout()).toContain("Type: policy.self_check");

    const unknown = harness();
    expect(await runCli(["explain", "missing"], unknown.dependencies)).toBe(3);
  });

  it("prints the catalogue in stable order", async () => {
    const value = harness();
    expect(await runCli(["catalog", "--json"], value.dependencies)).toBe(0);
    expect(JSON.parse(value.stdout())[0].type).toBe("policy.self_check");
    expect(JSON.parse(value.stdout())[0].definitionContract.assertions.require_sections).toEqual(["string"]);
  });

  it("returns cancellation exit code when the root signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const value = harness({ signal: controller.signal });
    expect(
      await runCli(
        ["run", "--config", "policy.yml", "--phase", "pre_deployment"],
        value.dependencies
      )
    ).toBe(3);
    expect(value.requests[0]?.cancellationSignal.aborted).toBe(true);
  });

  it("does not write credential values to either stream", async () => {
    const value = harness();
    await runCli(["plan", "--config", "policy.yml", "--phase", "pre_deployment"], {
      ...value.dependencies,
      environment: { TOKEN: "secret-token" }
    });
    expect(`${value.stdout()}${value.stderr()}`).not.toContain("secret-token");
  });
});
