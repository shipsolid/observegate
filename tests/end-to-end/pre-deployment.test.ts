import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "@observability-gate/cli";
import { describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { runGateScenario } from "./harness.js";

describe("pre-deployment release scenarios", () => {
  it("passes a complete policy self-check", async () => {
    const result = await runGateScenario({
      id: "readiness.policy",
      type: "policy.self_check",
      phase: "pre_deployment",
      value: {
        sections: [
          "identity",
          "targets",
          "providers",
          "gates.pre_deployment",
          "gates.post_deployment",
          "reporting",
          "security"
        ],
        uniqueGateIds: true,
        unknownFields: 0,
        inlineSecrets: 0,
        blockingPostGates: 1
      }
    });

    expect(result.decision).toBe("pass");
    expect(result.gates[0]?.status).toBe("passed");
  });

  it("executes the public CLI through policy loading, planning, provider resolution, and reporting", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "observegate-cli-e2e-"));
    const config = join(workspace, "observability-gate.yml");
    await writeFile(
      config,
      stringify({
        metadata: { name: "cli-e2e" },
        execution: {
          active_target: "test",
          phases: {
            pre_deployment: { timeout: "5s", concurrency: 1 },
            post_deployment: { timeout: "5s", concurrency: 1 }
          }
        },
        identity: {
          canonical: {
            service_name: "checkout",
            service_namespace: "commerce",
            environment: "test",
            release_id: "release-candidate",
            deployment_id: "deployment-1"
          }
        },
        release: { candidate: { id: "release-candidate" } },
        observation: { pre_deployment: {}, post_deployment: {} },
        decision: {
          outcomes: {
            pass: { exit_code: 0, conclusion: "success" },
            warn: { exit_code: 0, conclusion: "neutral" },
            fail: { exit_code: 1, conclusion: "failure" },
            inconclusive: { exit_code: 2, conclusion: "failure" },
            error: { exit_code: 3, conclusion: "failure" }
          }
        },
        targets: { definitions: { test: { runtime: { type: "generic", provider: "local" } } } },
        providers: { evidence: { local: { type: "file" } } },
        gate_defaults: {},
        gates: {
          pre_deployment: [
            {
              id: "readiness.identity",
              name: "Identity",
              type: "identity.contract",
              assertions: { release_id: { minimum_length: 7, maximum_length: 128 } }
            }
          ],
          post_deployment: [{ id: "workload.ready", name: "Ready", type: "runtime.ready" }]
        },
        reporting: {},
        security: {},
        limits: {}
      })
    );
    let stdout = "";
    let stderr = "";

    try {
      const code = await runCli(
        ["run", "--config", config, "--phase", "pre_deployment", "--json"],
        {
          workspaceRoot: workspace,
          output: {
            stdout: (value) => {
              stdout += value;
            },
            stderr: (value) => {
              stderr += value;
            }
          }
        }
      );

      expect(code).toBe(0);
      expect(JSON.parse(stdout)).toMatchObject({ decision: "pass", phase: "pre_deployment" });
      expect(stderr).toBe("");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing runbook", "readiness.runbook", "asset.url"],
    ["invalid query", "readiness.gate-queries", "telemetry.query_validation"],
    ["broken OTLP identity", "readiness.telemetry-contract", "evidence.otlp_contract"],
    ["high cardinality", "risk.cardinality-change", "telemetry.cardinality_estimate"],
    ["active alert", "risk.active-alerts", "grafana.alert_state"],
    ["exhausted budget", "risk.error-budget", "grafana.error_budget"],
    ["collector backpressure", "risk.collector-health", "telemetry.collector_health"],
    ["deployment freeze", "risk.change-freeze", "policy.change_window"],
    ["invalid Kubernetes manifest", "kubernetes.manifest", "kubernetes.manifest"]
  ])("blocks on %s", async (_name, id, type) => {
    const value =
      type === "policy.change_window"
        ? { freezeActive: true }
        : type === "telemetry.cardinality_estimate"
          ? { estimate: 2_000_000, budget: 1_000_000 }
          : {};
    const result = await runGateScenario({
      id,
      type,
      phase: "pre_deployment",
      value,
      ...(type === "telemetry.cardinality_estimate"
        ? { definition: { enforcement: "advisory" as const }, enforcement: "advisory" as const }
        : {})
    });

    if (type === "telemetry.cardinality_estimate") {
      expect(result.decision).toBe("warn");
      expect(result.gates[0]?.status).toBe("warned");
    } else {
      expect(result.decision).toBe("fail");
      expect(result.gates[0]?.status).toBe("failed");
    }
  });

  it("keeps SARIF findings advisory", async () => {
    const result = await runGateScenario({
      id: "readiness.static-analysis",
      type: "evidence.sarif",
      phase: "pre_deployment",
      enforcement: "advisory",
      value: { findings: [{ ruleId: "otel.identity", level: "error", message: "missing" }] }
    });

    expect(result.decision).toBe("warn");
    expect(result.gates[0]?.status).toBe("warned");
  });
});
