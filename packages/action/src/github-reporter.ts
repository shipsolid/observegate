import * as github from "@actions/github";
import type { Diagnostic, ExecutionResult } from "@observability-gate/core";
import { renderMarkdown } from "@observability-gate/reporters";
import { githubActionsRuntime, type ActionRuntime } from "./actions-runtime.js";

const commentMarker = "<!-- observability-gate -->";

export async function writeStepSummary(
  result: ExecutionResult,
  runtime: ActionRuntime = githubActionsRuntime
): Promise<void> {
  await runtime.writeSummary(renderMarkdown(result));
}

function annotations(result: ExecutionResult) {
  return result.gates
    .flatMap((gate) =>
      gate.diagnostics.flatMap((diagnostic: Diagnostic) =>
        diagnostic.artifactLocation === undefined
          ? []
          : [
              {
                path: diagnostic.artifactLocation.uri,
                start_line: diagnostic.artifactLocation.line ?? 1,
                end_line: diagnostic.artifactLocation.line ?? 1,
                ...(diagnostic.artifactLocation.column === undefined
                  ? {}
                  : {
                      start_column: diagnostic.artifactLocation.column,
                      end_column: diagnostic.artifactLocation.column
                    }),
                annotation_level:
                  gate.enforcement === "blocking" ? ("failure" as const) : ("warning" as const),
                message: diagnostic.message,
                title: gate.id
              }
            ]
      )
    )
    .slice(0, 50);
}

export async function publishCheck(result: ExecutionResult, token: string): Promise<void> {
  const octokit = github.getOctokit(token);
  await octokit.rest.checks.create({
    ...github.context.repo,
    name: "Observability Gate",
    head_sha: github.context.sha,
    status: "completed",
    conclusion:
      result.decision === "pass" ? "success" : result.decision === "warn" ? "neutral" : "failure",
    output: {
      title: `Observability Gate: ${result.decision}`,
      summary: `Phase ${result.phase}; evidence coverage ${result.evidenceCoveragePercent}%`,
      annotations: annotations(result)
    }
  });
}

export async function updatePullRequestComment(
  result: ExecutionResult,
  token: string
): Promise<void> {
  const issueNumber = github.context.payload.pull_request?.number;
  if (issueNumber === undefined) return;
  const octokit = github.getOctokit(token);
  const body = `${commentMarker}\n${renderMarkdown(result)}`;
  const comments = await octokit.rest.issues.listComments({
    ...github.context.repo,
    issue_number: issueNumber,
    per_page: 100
  });
  const existing = comments.data.find((comment) => comment.body?.includes(commentMarker));
  if (existing === undefined) {
    await octokit.rest.issues.createComment({
      ...github.context.repo,
      issue_number: issueNumber,
      body
    });
  } else {
    await octokit.rest.issues.updateComment({
      ...github.context.repo,
      comment_id: existing.id,
      body
    });
  }
}
