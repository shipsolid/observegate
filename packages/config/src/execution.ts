import {
  stableFingerprint,
  type ExecutionPlan,
  type ExecutionRequest,
  type PreparedExecution
} from "@observability-gate/core";
import type { RawPolicy } from "./schema/policy.js";

export function parseDurationMs(value: string | undefined, fallback = 0): number {
  if (value === undefined) return fallback;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u.exec(value);
  if (match?.[1] === undefined || match[2] === undefined) return fallback;
  return (
    Number(match[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] ?? 1)
  );
}

function missing(
  value: string | undefined,
  fallback: "fail" | "warn" | "inconclusive"
): "fail" | "warn" | "inconclusive" {
  return value === "warn" || value === "inconclusive" || value === "fail" ? value : fallback;
}

export function describePolicyExecution(
  policy: RawPolicy,
  plan: ExecutionPlan,
  request: ExecutionRequest
): PreparedExecution {
  const provider = policy.targets.definitions[plan.targetId]?.runtime.provider;
  const links = Object.fromEntries(
    Object.entries(policy.reporting.links ?? {}).flatMap(([name, environmentName]) => {
      const value =
        typeof environmentName === "string"
          ? safeReportLink(environmentName, request.environment)
          : undefined;
      return value === undefined ? [] : [[name, value]];
    })
  );
  return {
    phase: request.phase,
    target: {
      id: plan.targetId,
      runtimeType: plan.runtimeType,
      provider: typeof provider === "string" ? provider : "unresolved"
    },
    release: {
      candidateId: policy.release.candidate.id,
      deploymentId: policy.identity.canonical.deployment_id,
      ...(policy.release.baseline?.explicit_release_id === undefined
        ? {}
        : { baselineId: policy.release.baseline.explicit_release_id })
    },
    decisionPolicy: {
      minimumEvidenceCoveragePercent:
        policy.execution.enforcement?.minimum_evidence_coverage_percent ?? 100,
      warnOnSkipped: true
    },
    missingEvidenceBehavior: {
      blocking: missing(
        policy.observation.no_data?.blocking_gate ??
          policy.execution.enforcement?.missing_blocking_evidence,
        "fail"
      ),
      advisory: missing(policy.observation.no_data?.advisory_gate, "warn"),
      comparison: missing(policy.observation.no_data?.comparison_gate, "inconclusive"),
      synthetic: missing(policy.observation.no_data?.synthetic_gate, "fail")
    },
    observation: {
      warmupMs: parseDurationMs(policy.observation.post_deployment.warmup),
      evaluationWindowMs: parseDurationMs(policy.observation.post_deployment.evaluation_window),
      sampleIntervalMs: parseDurationMs(policy.observation.post_deployment.settle_between_samples),
      minimumSuccessfulSamples: policy.observation.post_deployment.minimum_successful_samples ?? 1,
      maximumExtensionMs: parseDurationMs(policy.release.comparison?.maximum_extension)
    },
    ...(typeof object(policy.reporting.artifacts).retention_days === "number"
      ? { artifactRetentionDays: object(policy.reporting.artifacts).retention_days as number }
      : {}),
    links,
    configurationFingerprint: stableFingerprint(policy)
  };
}

function enabled(value: unknown, fallback: boolean): boolean {
  return value !== null &&
    typeof value === "object" &&
    "enabled" in value &&
    typeof value.enabled === "boolean"
    ? value.enabled
    : fallback;
}

export interface GithubReportingOptions {
  readonly checkRun: boolean;
  readonly stepSummary: boolean;
  readonly pullRequestComment: boolean;
  readonly checkRunName?: string;
  readonly checkRunInclude?: readonly CheckRunField[];
  readonly annotations?: { readonly enabled: boolean; readonly maximum: number };
  readonly stepSummarySections?: readonly SummarySection[];
  readonly pullRequestMarker?: string;
  readonly pullRequestMode?: "update_single_comment";
  readonly pullRequestOnlyWhen?: readonly ("pull_request" | "pull_request_target")[];
}

export function githubReportingOptions(policy: RawPolicy): GithubReportingOptions {
  const github = policy.reporting.github ?? {};
  const check = object(github.check_run);
  const summary = object(github.step_summary);
  const comment = object(github.pull_request_comment);
  const annotations = object(check.annotations);
  return {
    checkRun: enabled(check, false),
    stepSummary: enabled(summary, true),
    pullRequestComment: enabled(comment, false),
    ...(typeof check.name === "string" ? { checkRunName: check.name } : {}),
    ...(Array.isArray(check.include) ? { checkRunInclude: check.include as CheckRunField[] } : {}),
    ...(check.annotations === undefined
      ? {}
      : {
          annotations: {
            enabled: enabled(annotations, true),
            maximum: typeof annotations.maximum === "number" ? annotations.maximum : 50
          }
        }),
    ...(Array.isArray(summary.sections)
      ? { stepSummarySections: summary.sections as SummarySection[] }
      : {}),
    ...(typeof comment.marker === "string" ? { pullRequestMarker: comment.marker } : {}),
    ...(comment.mode === "update_single_comment" ? { pullRequestMode: comment.mode } : {}),
    ...(Array.isArray(comment.only_when)
      ? { pullRequestOnlyWhen: comment.only_when as ("pull_request" | "pull_request_target")[] }
      : {})
  };
}

export type CheckRunField =
  | "final_decision"
  | "phase"
  | "target"
  | "release"
  | "gate_summary"
  | "failed_assertions"
  | "evidence_age"
  | "remediation";
export type SummarySection =
  | "decision"
  | "identity"
  | "target"
  | "evidence_coverage"
  | "blocking_gates"
  | "advisory_gates"
  | "skipped_gates"
  | "comparisons"
  | "links";
export type ArtifactFormat = "json" | "markdown" | "junit" | "sarif";
export interface PublicationOptions {
  readonly github: GithubReportingOptions;
  readonly directory?: string;
  readonly formats: readonly ArtifactFormat[];
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function publicationOptions(policy: RawPolicy): PublicationOptions {
  const artifacts = object(policy.reporting.artifacts);
  return {
    github: githubReportingOptions(policy),
    ...(typeof artifacts.directory === "string" ? { directory: artifacts.directory } : {}),
    formats: Array.isArray(artifacts.formats)
      ? (artifacts.formats as ArtifactFormat[])
      : ["json", "markdown", "junit", "sarif"]
  };
}

function safeReportLink(
  environmentName: string,
  environment: ExecutionRequest["environment"]
): string | undefined {
  if (/TOKEN|PASSWORD|SECRET|KEY|COOKIE|CREDENTIAL|AUTHORIZATION/iu.test(environmentName))
    return undefined;
  const value = environment[environmentName];
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return undefined;
    const secrets = Object.entries(environment).flatMap(([name, value]) =>
      /TOKEN|PASSWORD|SECRET|KEY|COOKIE|CREDENTIAL|AUTHORIZATION/iu.test(name) &&
      value !== undefined &&
      value.length >= 4
        ? [value]
        : []
    );
    if (
      secrets.some(
        (secret) =>
          decodeURIComponent(url.pathname).includes(secret) || url.hostname.includes(secret)
      )
    )
      return undefined;
    for (const [name, value] of url.searchParams) {
      if (
        /token|password|secret|key|cookie|credential|authorization|signature/iu.test(name) ||
        secrets.some((secret) => value.includes(secret))
      )
        url.searchParams.set(name, "REDACTED");
    }
    url.hash = "";
    return url.href.replaceAll("(", "%28").replaceAll(")", "%29");
  } catch {
    return undefined;
  }
}
