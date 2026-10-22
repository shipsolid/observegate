import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";

const mocks = vi.hoisted(() => {
  const inputs = new Map<string, string>();
  const outputs = new Map<string, unknown>();
  return {
    inputs,
    outputs,
    setFailed: vi.fn(),
    warning: vi.fn(),
    writeSummary: vi.fn(async () => undefined),
    writeReports: vi.fn(async () => ({
      paths: { json: "/tmp/observability-gate.json" },
      totalBytes: 100
    }))
  };
});

const runtime = {
  getInput: (name: string, options?: { required?: boolean }) => {
    const value = mocks.inputs.get(name) ?? "";
    if (options?.required === true && value.length === 0) throw new Error(`Missing input: ${name}`);
    return value;
  },
  setOutput: (name: string, value: unknown) => mocks.outputs.set(name, value),
  setFailed: mocks.setFailed,
  warning: mocks.warning,
  writeSummary: mocks.writeSummary
};

vi.mock("@actions/github", () => ({
  context: { repo: { owner: "shipsolid", repo: "observegate" }, sha: "abc", payload: {} },
  getOctokit: vi.fn()
}));

vi.mock("@observability-gate/reporters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@observability-gate/reporters")>();
  return { ...original, writeReports: mocks.writeReports };
});

import { runAction } from "../src/main.js";

function result(decision: ExecutionResult["decision"]): ExecutionResult {
  return {
    decision,
    phase: "post_deployment",
    target: { id: "production", runtimeType: "kubernetes", provider: "aks" },
    release: { candidateId: "release-1", deploymentId: "deploy-1", baselineId: "release-0" },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    evidenceCoveragePercent: 100,
    gates: [],
    diagnostics: [],
    links: {}
  };
}

describe("GitHub Action adapter", () => {
  beforeEach(() => {
    mocks.inputs.clear();
    mocks.outputs.clear();
    mocks.inputs.set("config", "observability-gate.yml");
    mocks.inputs.set("phase", "post_deployment");
    mocks.inputs.set("output-directory", "/tmp/reports");
    mocks.setFailed.mockClear();
    mocks.warning.mockClear();
    mocks.writeSummary.mockClear();
    mocks.writeReports.mockClear();
  });

  it("requires config and phase inputs", async () => {
    mocks.inputs.delete("config");
    await runAction({ service: { run: vi.fn() }, runtime });
    expect(mocks.setFailed).toHaveBeenCalledWith("Missing input: config");
  });

  it.each(["pass", "warn"] as const)("publishes %s outputs without failing", async (decision) => {
    const service = { run: vi.fn(async () => result(decision)) };
    await runAction({
      service,
      workspaceRoot: "/workspace",
      environment: { TOKEN: "secret-token" },
      runtime
    });

    expect(service.run).toHaveBeenCalledOnce();
    expect(mocks.outputs.get("decision")).toBe(decision);
    expect(mocks.outputs.get("target_id")).toBe("production");
    expect(mocks.outputs.get("report_path")).toBe("/tmp/observability-gate.json");
    expect(mocks.writeSummary).toHaveBeenCalledOnce();
    expect(mocks.setFailed).not.toHaveBeenCalled();
    expect(JSON.stringify([...mocks.outputs.values()])).not.toContain("secret-token");
  });

  it.each(["fail", "inconclusive", "error"] as const)("fails the step for %s", async (decision) => {
    await runAction({ service: { run: async () => result(decision) }, runtime });
    expect(mocks.setFailed).toHaveBeenCalledWith(`Observability Gate decision: ${decision}`);
  });

  it("passes the target override and phase to the service", async () => {
    mocks.inputs.set("target", "blue");
    const service = { run: vi.fn(async () => result("pass")) };
    await runAction({ service, runtime });
    expect(service.run).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "post_deployment", targetOverride: "blue" })
    );
  });

  it("uses the report limit resolved from the policy", async () => {
    const service = {
      run: vi.fn(async () => result("pass")),
      maximumReportBytes: vi.fn(async () => 25 * 1024 * 1024)
    };

    await runAction({ service, runtime });

    expect(service.maximumReportBytes).toHaveBeenCalledWith(
      expect.objectContaining({ configPath: "observability-gate.yml" })
    );
    expect(mocks.writeReports).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maximumTotalBytes: 25 * 1024 * 1024 })
    );
  });

  it("degrades missing GitHub write permission to a reporting warning", async () => {
    mocks.inputs.set("github-token", "token-value");
    const github = await import("@actions/github");
    vi.mocked(github.getOctokit).mockReturnValue({
      rest: { checks: { create: vi.fn(async () => Promise.reject(new Error("forbidden"))) } }
    } as never);
    await runAction({
      service: {
        run: async () => result("pass"),
        reportingOptions: async () => ({
          checkRun: true,
          pullRequestComment: true,
          stepSummary: true
        })
      },
      runtime
    });
    expect(mocks.warning).toHaveBeenCalledWith(
      "GitHub report publication was not authorized; local reports are available."
    );
    expect(mocks.setFailed).not.toHaveBeenCalled();
  });

  it("honors disabled publication even with a token", async () => {
    mocks.inputs.set("github-token", "token");
    const github = await import("@actions/github");
    vi.mocked(github.getOctokit).mockClear();
    await runAction({
      service: {
        run: async () => result("pass"),
        reportingOptions: async () => ({
          checkRun: false,
          pullRequestComment: false,
          stepSummary: false
        })
      },
      runtime
    });
    expect(mocks.writeSummary).not.toHaveBeenCalled();
    expect(github.getOctokit).not.toHaveBeenCalled();
  });

  it("does not publish success outputs after cancellation during summary publication", async () => {
    mocks.writeSummary.mockImplementationOnce(async () => {
      process.emit("SIGTERM");
    });
    await runAction({ service: { run: async () => result("pass") }, runtime });
    expect(mocks.setFailed).toHaveBeenCalledWith("Action publication was cancelled.");
    expect(mocks.outputs.get("decision")).toBe("error");
    expect(mocks.outputs.get("report_path")).toBe("");
    expect(mocks.writeReports).not.toHaveBeenCalled();
  });

  it("publishes terminal error outputs when summary publication fails", async () => {
    mocks.writeSummary.mockRejectedValueOnce(new Error("secret-provider-value"));
    await runAction({ service: { run: async () => result("pass") }, runtime });
    expect(mocks.outputs.get("decision")).toBe("error");
    expect(mocks.outputs.get("release_id")).toBe("release-1");
    expect(mocks.writeReports).toHaveBeenLastCalledWith(
      expect.objectContaining({
        decision: "error",
        diagnostics: [expect.objectContaining({ code: "REPORTING" })]
      }),
      expect.anything()
    );
    expect(mocks.setFailed.mock.calls.flat().join(" ")).not.toContain("secret-provider-value");
  });

  it("preserves a completed fail when artifact publication fails", async () => {
    mocks.writeReports.mockRejectedValueOnce(new Error("disk failure"));
    await runAction({ service: { run: async () => result("fail") }, runtime });
    expect(mocks.outputs.get("decision")).toBe("fail");
    expect(mocks.outputs.get("report_path")).toBe("");
    expect(mocks.setFailed).toHaveBeenCalled();
  });
});

describe("Action artifact publication contract", () => {
  beforeEach(() => {
    mocks.inputs.clear();
    mocks.inputs.set("config", "observability-gate.yml");
    mocks.inputs.set("phase", "post_deployment");
    mocks.outputs.clear();
    mocks.writeReports.mockClear();
    mocks.writeSummary.mockClear();
    mocks.setFailed.mockClear();
  });
  it("uses configured artifact directory/formats when input is empty", async () => {
    await runAction({
      runtime,
      service: {
        run: async () => result("pass"),
        publicationOptions: async () => ({
          github: { checkRun: false, stepSummary: false, pullRequestComment: false },
          directory: "/tmp/configured",
          formats: ["junit"]
        })
      }
    });
    expect(mocks.writeReports).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ directory: "/tmp/configured", formats: ["junit"] })
    );
    expect(mocks.writeSummary).not.toHaveBeenCalled();
  });
  it("gives the Action input priority over configured artifact directory", async () => {
    mocks.inputs.set("output-directory", "/tmp/explicit");
    await runAction({
      runtime,
      service: {
        run: async () => result("pass"),
        publicationOptions: async () => ({
          github: { checkRun: false, stepSummary: false, pullRequestComment: false },
          directory: "/tmp/configured",
          formats: ["markdown"]
        })
      }
    });
    expect(mocks.writeReports).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ directory: "/tmp/explicit", formats: ["markdown"] })
    );
  });
});
