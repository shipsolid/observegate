import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/index.js";
import { describePolicyExecution, githubReportingOptions } from "../src/execution.js";
import type { ExecutionPlan, ExecutionRequest } from "@observability-gate/core";

describe("shared execution policy", () => {
  it("honors no-data behavior and day durations through the same adapter", async () => {
    const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
    policy.observation.no_data = {
      blocking_gate: "inconclusive",
      advisory_gate: "warn",
      comparison_gate: "inconclusive",
      synthetic_gate: "fail"
    };
    policy.observation.post_deployment.warmup = "1d";
    const plan: ExecutionPlan = {
      phase: "post_deployment",
      targetId: "test",
      runtimeType: "generic",
      gates: [],
      requiredProviders: [],
      deadlineMs: 1000
    };
    const request: ExecutionRequest = {
      workspaceRoot: process.cwd(),
      configPath: "policy.yml",
      phase: "post_deployment",
      environment: {},
      cancellationSignal: new AbortController().signal
    };
    const execution = describePolicyExecution(policy, plan, request);
    expect(execution.missingEvidenceBehavior.blocking).toBe("inconclusive");
    expect(execution.observation.warmupMs).toBe(86_400_000);
  });

  it("keeps remote publication off unless explicitly enabled", async () => {
    const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
    expect(githubReportingOptions(policy)).toEqual({
      checkRun: false,
      stepSummary: true,
      pullRequestComment: false
    });
    policy.reporting.github = {
      check_run: { enabled: true },
      step_summary: { enabled: false },
      pull_request_comment: { enabled: true }
    };
    expect(githubReportingOptions(policy)).toEqual({
      checkRun: true,
      stepSummary: false,
      pullRequestComment: true
    });
  });
});

describe("publication contract options", () => {
  it("carries all accepted check, summary, and comment selections", async () => {
    const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
    policy.reporting.github = {
      check_run: {
        enabled: true,
        name: "Release safety",
        include: ["phase", "gate_summary"],
        annotations: { enabled: false, maximum: 3 }
      },
      step_summary: { enabled: true, sections: ["decision", "links"] },
      pull_request_comment: {
        enabled: true,
        marker: "release-safety",
        mode: "update_single_comment",
        only_when: ["pull_request"]
      }
    };
    expect(githubReportingOptions(policy)).toMatchObject({
      checkRunName: "Release safety",
      checkRunInclude: ["phase", "gate_summary"],
      annotations: { enabled: false, maximum: 3 },
      stepSummarySections: ["decision", "links"],
      pullRequestMarker: "release-safety",
      pullRequestMode: "update_single_comment",
      pullRequestOnlyWhen: ["pull_request"]
    });
  });
  it("omits unsafe report links and removes sensitive query values", async () => {
    const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
    policy.reporting.links = {
      bad: "PLAIN_VALUE",
      credentials: "CREDENTIAL_URL",
      http: "HTTP_URL",
      dashboard: "DASHBOARD_URL",
      token: "API_TOKEN"
    };
    const plan: ExecutionPlan = {
      phase: "pre_deployment",
      targetId: "test",
      runtimeType: "generic",
      gates: [],
      requiredProviders: [],
      deadlineMs: 1000
    };
    const request: ExecutionRequest = {
      workspaceRoot: process.cwd(),
      configPath: "policy.yml",
      phase: "pre_deployment",
      environment: {
        PLAIN_VALUE: "secret-value",
        CREDENTIAL_URL: "https://user:password@example.com",
        HTTP_URL: "http://example.com",
        DASHBOARD_URL: "https://grafana.example.com/d/test?service=checkout&token=top-secret",
        API_TOKEN: "https://example.com/secret"
      },
      cancellationSignal: new AbortController().signal
    };
    const links = describePolicyExecution(policy, plan, request).links;
    expect(Object.keys(links)).toEqual(["dashboard"]);
    expect(links.dashboard).toBe(
      "https://grafana.example.com/d/test?service=checkout&token=REDACTED"
    );
    expect(JSON.stringify(links)).not.toContain("top-secret");
  });
});

describe("known secret protection in report links", () => {
  it("redacts secret values hidden behind nonsensitive query names", async () => {
    const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
    policy.reporting.links = { dashboard: "DASHBOARD_URL", unsafePath: "PATH_URL" };
    const plan: ExecutionPlan = {
      phase: "pre_deployment",
      targetId: "test",
      runtimeType: "generic",
      gates: [],
      requiredProviders: [],
      deadlineMs: 1000
    };
    const request: ExecutionRequest = {
      workspaceRoot: process.cwd(),
      configPath: "policy.yml",
      phase: "pre_deployment",
      environment: {
        GRAFANA_TOKEN: "known-secret-value",
        DASHBOARD_URL:
          "https://grafana.example.com/d/test?query=prefix-known-secret-value&service=checkout",
        PATH_URL: "https://grafana.example.com/known-secret-value"
      },
      cancellationSignal: new AbortController().signal
    };
    const links = describePolicyExecution(policy, plan, request).links;
    expect(links.dashboard).toBe(
      "https://grafana.example.com/d/test?query=REDACTED&service=checkout"
    );
    expect(links.unsafePath).toBeUndefined();
    expect(JSON.stringify(links)).not.toContain("known-secret-value");
  });
  it("carries configured retention as downstream artifact metadata", async () => {
    const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
    policy.reporting.artifacts = { retention_days: 14 };
    const plan: ExecutionPlan = {
      phase: "pre_deployment",
      targetId: "test",
      runtimeType: "generic",
      gates: [],
      requiredProviders: [],
      deadlineMs: 1000
    };
    const request: ExecutionRequest = {
      workspaceRoot: process.cwd(),
      configPath: "policy.yml",
      phase: "pre_deployment",
      environment: {},
      cancellationSignal: new AbortController().signal
    };
    expect(describePolicyExecution(policy, plan, request)).toMatchObject({
      artifactRetentionDays: 14
    });
  });
});
