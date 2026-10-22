import * as github from "@actions/github";
import type { GithubReportingOptions } from "@observability-gate/config";
import type { Diagnostic, ExecutionResult } from "@observability-gate/core";
import { renderMarkdown } from "@observability-gate/reporters";
import { githubActionsRuntime, type ActionRuntime } from "./actions-runtime.js";

const commentMarker = "<!-- observability-gate -->";

export async function writeStepSummary(
  result: ExecutionResult,
  runtime: ActionRuntime = githubActionsRuntime,
  options?: GithubReportingOptions
): Promise<void> {
  await runtime.writeSummary(
    renderMarkdown(
      result,
      options?.stepSummarySections === undefined ? {} : { sections: options.stepSummarySections }
    )
  );
}

function annotations(result: ExecutionResult, maximum = 50) {
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
    .slice(0, Math.min(50, maximum));
}

export async function publishCheck(
  result: ExecutionResult,
  token: string,
  signal?: AbortSignal,
  options?: GithubReportingOptions
): Promise<void> {
  signal?.throwIfAborted();
  const octokit = github.getOctokit(token);
  await octokit.rest.checks.create({
    ...(signal === undefined ? {} : { request: { signal } }),
    ...github.context.repo,
    name: options?.checkRunName ?? "Observability Gate",
    head_sha: github.context.sha,
    status: "completed",
    conclusion:
      result.decision === "pass" ? "success" : result.decision === "warn" ? "neutral" : "failure",
    output: {
      title:
        options?.checkRunInclude !== undefined &&
        !options.checkRunInclude.includes("final_decision")
          ? "Observability Gate report"
          : `Observability Gate: ${result.decision}`,
      summary: checkSummary(result, options),
      annotations:
        options?.annotations?.enabled === false
          ? []
          : annotations(result, options?.annotations?.maximum)
    }
  });
  signal?.throwIfAborted();
}

export async function updatePullRequestComment(
  result: ExecutionResult,
  token: string,
  signal?: AbortSignal,
  options?: GithubReportingOptions
): Promise<void> {
  signal?.throwIfAborted();
  const eventName =
    github.context.eventName ||
    (github.context.payload.pull_request === undefined ? "" : "pull_request");
  if (
    options?.pullRequestOnlyWhen !== undefined &&
    !options.pullRequestOnlyWhen.some((event) => event === eventName)
  )
    return;
  const issueNumber = github.context.payload.pull_request?.number;
  if (issueNumber === undefined) return;
  const octokit = github.getOctokit(token);
  const marker =
    options?.pullRequestMarker === undefined
      ? commentMarker
      : `<!-- ${options.pullRequestMarker} -->`;
  const body = `${marker}\n${renderMarkdown(result)}`;
  let existing: { id: number } | undefined;
  for (let page = 1; page <= 100; page += 1) {
    const comments = await octokit.rest.issues.listComments({
      ...(signal === undefined ? {} : { request: { signal } }),
      ...github.context.repo,
      issue_number: issueNumber,
      per_page: 100,
      page
    });
    signal?.throwIfAborted();
    existing = comments.data.find((comment) => comment.body?.includes(marker));
    if (existing !== undefined || comments.data.length < 100) break;
    if (page === 100) throw new Error("Pull request comments exceeded the search limit");
  }
  if (existing === undefined) {
    await octokit.rest.issues.createComment({
      ...(signal === undefined ? {} : { request: { signal } }),
      ...github.context.repo,
      issue_number: issueNumber,
      body
    });
  } else {
    await octokit.rest.issues.updateComment({
      ...(signal === undefined ? {} : { request: { signal } }),
      ...github.context.repo,
      comment_id: existing.id,
      body
    });
  }
  signal?.throwIfAborted();
}

function checkSummary(result: ExecutionResult, options?: GithubReportingOptions): string {
  const include = options?.checkRunInclude ?? [
    "final_decision",
    "phase",
    "target",
    "release",
    "gate_summary",
    "failed_assertions",
    "evidence_age",
    "remediation"
  ];
  const lines: string[] = [];
  if (include.includes("final_decision")) lines.push(`Decision: ${result.decision}`);
  if (include.includes("phase")) lines.push(`Phase: ${result.phase}`);
  if (include.includes("target")) lines.push(`Target: ${result.target.id}`);
  if (include.includes("release")) lines.push(`Release: ${result.release.candidateId}`);
  if (include.includes("gate_summary"))
    lines.push(`Gates: ${result.gates.map((gate) => `${gate.id}: ${gate.status}`).join("; ")}`);
  if (include.includes("failed_assertions"))
    for (const gate of result.gates)
      for (const assertion of gate.assertions)
        if (assertion.status !== "passed") lines.push(`${gate.id}: ${assertion.message}`);
  if (include.includes("evidence_age"))
    for (const gate of result.gates)
      for (const evidence of gate.evidence)
        lines.push(
          `${gate.id}: ${evidence.ageMs === undefined ? "evidence age unavailable" : `evidence age ${evidence.ageMs}ms`}`
        );
  if (include.includes("remediation"))
    for (const gate of result.gates)
      if (gate.remediation !== undefined) lines.push(`${gate.id}: ${gate.remediation}`);
  for (const diagnostic of result.diagnostics)
    lines.push(`${diagnostic.code}: ${diagnostic.message}`);
  return (lines.join("\n") || "Observability Gate report.").slice(0, 60_000);
}
