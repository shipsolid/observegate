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

import { publishCheck, updatePullRequestComment } from "../src/github-reporter.js";

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
