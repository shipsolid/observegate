import * as core from "@actions/core";
import type { ExecutionResult } from "@observability-gate/core";

export function setActionOutputs(result: ExecutionResult, reportPath: string): void {
  const count = (status: ExecutionResult["gates"][number]["status"]) =>
    result.gates.filter((gate) => gate.status === status).length;
  core.setOutput("decision", result.decision);
  core.setOutput("phase", result.phase);
  core.setOutput("target_id", result.target.id);
  core.setOutput("release_id", result.release.candidateId);
  core.setOutput("baseline_release_id", result.release.baselineId ?? "");
  core.setOutput("passed_count", count("passed"));
  core.setOutput("warned_count", count("warned"));
  core.setOutput("failed_count", count("failed"));
  core.setOutput("skipped_count", count("skipped"));
  core.setOutput("evidence_coverage_percent", result.evidenceCoveragePercent);
  core.setOutput("report_path", reportPath);
}
