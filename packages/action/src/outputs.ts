import type { ExecutionResult } from "@observability-gate/core";
import { githubActionsRuntime, type ActionRuntime } from "./actions-runtime.js";

export function setActionOutputs(
  result: ExecutionResult,
  reportPath: string,
  runtime: ActionRuntime = githubActionsRuntime
): void {
  const count = (status: ExecutionResult["gates"][number]["status"]) =>
    result.gates.filter((gate) => gate.status === status).length;
  runtime.setOutput("decision", result.decision);
  runtime.setOutput("phase", result.phase);
  runtime.setOutput("target_id", result.target.id);
  runtime.setOutput("release_id", result.release.candidateId);
  runtime.setOutput("baseline_release_id", result.release.baselineId ?? "");
  runtime.setOutput("passed_count", count("passed"));
  runtime.setOutput("warned_count", count("warned"));
  runtime.setOutput("failed_count", count("failed"));
  runtime.setOutput("skipped_count", count("skipped"));
  runtime.setOutput("evidence_coverage_percent", result.evidenceCoveragePercent);
  runtime.setOutput("report_path", reportPath);
}
