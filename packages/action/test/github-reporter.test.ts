import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";

const mocks = vi.hoisted(() => ({
  create: vi.fn(async () => undefined),
  listComments: vi.fn(async () => ({ data: [] })),
  createComment: vi.fn(async () => undefined),
  updateComment: vi.fn(async () => undefined)
}));

vi.mock("@actions/github", () => ({
  context: {
    repo: { owner: "shipsolid", repo: "observegate" },
    sha: "abc123",
    payload: { pull_request: { number: 42 } }
  },
  getOctokit: () => ({
    rest: {
      checks: { create: mocks.create },
      issues: {
        listComments: mocks.listComments,
        createComment: mocks.createComment,
        updateComment: mocks.updateComment
      }
    }
  })
}));

import {
  publishCheck,
  updatePullRequestComment,
  writeStepSummary
} from "../src/github-reporter.js";

function result(): ExecutionResult {
  return {
    decision: "fail",
    phase: "post_deployment",
    target: { id: "production", runtimeType: "kubernetes", provider: "aks" },
    release: { candidateId: "release-1", deploymentId: "deploy-1" },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    evidenceCoveragePercent: 100,
    gates: Array.from({ length: 55 }, (_, index) => ({
      id: `identity-${index}`,
      name: `Identity ${index}`,
      type: "telemetry.identity",
      phase: "post_deployment" as const,
      enforcement: "blocking" as const,
      status: "failed" as const,
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1_000,
      assertions: [],
      evidence: [],
      diagnostics: [
        {
          code: "EVIDENCE_INVALID",
          message: `Identity mismatch ${index}`,
          retryable: false,
          artifactLocation: { uri: `fixtures/${index}.yml`, line: 1 }
        }
      ]
    })),
    diagnostics: [],
    links: {}
  };
}

describe("GitHub reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("caps check annotations at 50 and uses stable gate IDs", async () => {
    await publishCheck(result(), "token");
    const request = mocks.create.mock.calls[0]?.[0];
    expect(request?.output.annotations).toHaveLength(50);
    expect(request?.output.annotations[0].title).toBe("identity-0");
    expect(request?.conclusion).toBe("failure");
  });

  it("updates the single marker comment when it exists", async () => {
    mocks.listComments.mockResolvedValueOnce({
      data: [{ id: 7, body: "<!-- observability-gate -->\nold" }]
    });
    await updatePullRequestComment(result(), "token");
    expect(mocks.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 7, body: expect.stringContaining("identity-0") })
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
  });
});

describe("GitHub reporting selections", () => {
  it("limits the step summary to configured sections", async () => {
    let markdown = "";
    await writeStepSummary(
      result(),
      {
        writeSummary: async (text: string) => {
          markdown = text;
        }
      } as never,
      {
        checkRun: false,
        stepSummary: true,
        pullRequestComment: false,
        stepSummarySections: ["decision", "target"]
      }
    );
    expect(markdown).toContain("Decision:");
    expect(markdown).toContain("production");
    expect(markdown).not.toContain("identity-0");
    expect(markdown).not.toContain("## Links");
    expect(markdown).not.toContain("release-1");
  });
  beforeEach(() => vi.clearAllMocks());
  it("honors configured check name, included fields, and disabled annotations", async () => {
    await publishCheck(result(), "token", undefined, {
      checkRun: true,
      stepSummary: true,
      pullRequestComment: false,
      checkRunName: "Release safety",
      checkRunInclude: ["phase"],
      annotations: { enabled: false, maximum: 2 }
    });
    const request = mocks.create.mock.calls[0]?.[0];
    expect(request?.name).toBe("Release safety");
    expect(request?.output.summary).toContain("post_deployment");
    expect(request?.output.summary).not.toContain("production");
    expect(request?.output.annotations).toEqual([]);
  });
  it("honors the configured lower annotation cap", async () => {
    await publishCheck(result(), "token", undefined, {
      checkRun: true,
      stepSummary: true,
      pullRequestComment: false,
      annotations: { enabled: true, maximum: 2 }
    });
    expect(mocks.create.mock.calls[0]?.[0]?.output.annotations).toHaveLength(2);
  });
  it("uses the configured marker and searches beyond the first comment page", async () => {
    mocks.listComments.mockResolvedValueOnce({
      data: Array.from({ length: 100 }, (_, id) => ({ id, body: "Unrelated" }))
    });
    mocks.listComments.mockResolvedValueOnce({
      data: [{ id: 200, body: "<!-- release-safety -->\nOld" }]
    });
    await updatePullRequestComment(result(), "token", undefined, {
      checkRun: false,
      stepSummary: false,
      pullRequestComment: true,
      pullRequestMarker: "release-safety",
      pullRequestOnlyWhen: ["pull_request"]
    });
    expect(mocks.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        comment_id: 200,
        body: expect.stringContaining("<!-- release-safety -->")
      })
    );
    expect(mocks.createComment).not.toHaveBeenCalled();
  });
  it("does not comment for a GitHub event outside only_when", async () => {
    await updatePullRequestComment(result(), "token", undefined, {
      checkRun: false,
      stepSummary: false,
      pullRequestComment: true,
      pullRequestOnlyWhen: ["pull_request_target"]
    });
    expect(mocks.listComments).not.toHaveBeenCalled();
  });
});

describe("complete summary selections", () => {
  it.each([
    ["blocking_gates", "blocking-main", ["advisory-main", "skipped-main", "compare-main"]],
    ["advisory_gates", "advisory-main", ["blocking-main", "skipped-main", "compare-main"]],
    ["skipped_gates", "skipped-main", ["blocking-main", "advisory-main", "compare-main"]],
    ["comparisons", "compare-main", ["blocking-main", "advisory-main", "skipped-main"]]
  ] as const)("renders only %s gate sections", async (section, included, excluded) => {
    const base = result();
    const gate = base.gates[0];
    if (gate === undefined) throw new Error("Missing fixture gate");
    const selected: ExecutionResult = {
      ...base,
      gates: [
        { ...gate, id: "blocking-main" },
        { ...gate, id: "advisory-main", enforcement: "advisory" },
        { ...gate, id: "skipped-main", status: "skipped" },
        { ...gate, id: "compare-main", type: "metric.compare" }
      ]
    };
    let markdown = "";
    await writeStepSummary(
      selected,
      {
        writeSummary: async (text: string) => {
          markdown = text;
        }
      } as never,
      {
        checkRun: false,
        stepSummary: true,
        pullRequestComment: false,
        stepSummarySections: [section]
      }
    );
    expect(markdown).toContain(included);
    for (const id of excluded) expect(markdown).not.toContain(id);
  });
  it("includes configured assertion, age, and remediation details in checks", async () => {
    mocks.create.mockClear();
    const base = result();
    const gate = base.gates[0];
    if (gate === undefined) throw new Error("Missing fixture gate");
    await publishCheck(
      {
        ...base,
        gates: [
          {
            ...gate,
            assertions: [
              { assertion: "health", status: "failed", message: "Measured health failed" }
            ],
            evidence: [
              {
                id: "evidence",
                kind: "metric",
                provider: "metrics",
                acquiredAt: base.startedAt,
                fingerprint: "hash",
                ageMs: 500
              }
            ],
            remediation: "Inspect request failures"
          }
        ]
      },
      "token",
      undefined,
      {
        checkRun: true,
        stepSummary: false,
        pullRequestComment: false,
        checkRunInclude: ["failed_assertions", "evidence_age", "remediation"]
      }
    );
    const summary = mocks.create.mock.calls[0]?.[0]?.output.summary;
    expect(summary).toContain("Measured health failed");
    expect(summary).toContain("evidence age 500ms");
    expect(summary).toContain("Inspect request failures");
    expect(summary).not.toContain("Release:");
  });
});
