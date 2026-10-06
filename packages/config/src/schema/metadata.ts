export interface ConfigurationFieldMetadata {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly allowedValues?: readonly string[];
  readonly description: string;
}

export const configurationFields: readonly ConfigurationFieldMetadata[] = Object.freeze([
  { path: "metadata.name", type: "string", required: true, description: "Policy name." },
  { path: "metadata.description", type: "string", required: false, description: "Policy purpose." },
  { path: "metadata.owner", type: "string", required: false, description: "Owning team." },
  {
    path: "metadata.service_tier",
    type: "string",
    required: false,
    description: "Service criticality tier."
  },
  {
    path: "metadata.tags.*",
    type: "string",
    required: false,
    description: "Low-cardinality policy tags."
  },
  {
    path: "execution.active_target",
    type: "string",
    required: true,
    description: "Target selected for execution."
  },
  {
    path: "execution.environment_substitution.syntax",
    type: "string",
    required: false,
    defaultValue: "${VARIABLE_NAME}",
    description: "Environment interpolation syntax."
  },
  {
    path: "execution.environment_substitution.scope",
    type: "string",
    required: false,
    allowedValues: ["active_target_and_selected_phase"],
    description: "Interpolation scope."
  },
  {
    path: "execution.environment_substitution.missing_required_variable",
    type: "string",
    required: false,
    allowedValues: ["error"],
    description: "Missing variable behavior."
  },
  {
    path: "execution.environment_substitution.allow_default_values",
    type: "boolean",
    required: false,
    defaultValue: "false",
    description: "Whether inline defaults are permitted."
  },
  {
    path: "execution.phases.<phase>.timeout",
    type: "duration",
    required: true,
    description: "Overall phase deadline."
  },
  {
    path: "execution.phases.<phase>.concurrency",
    type: "positive integer",
    required: true,
    defaultValue: "8",
    description: "Maximum concurrent gates."
  },
  {
    path: "execution.retries.attempts",
    type: "non-negative integer",
    required: false,
    description: "Maximum retry attempts."
  },
  {
    path: "execution.retries.initial_backoff",
    type: "duration",
    required: false,
    description: "Initial retry delay."
  },
  {
    path: "execution.retries.maximum_backoff",
    type: "duration",
    required: false,
    description: "Retry delay ceiling."
  },
  {
    path: "execution.retries.retry_on[]",
    type: "string",
    required: false,
    description: "Retryable transport conditions."
  },
  {
    path: "execution.enforcement.default",
    type: "enum",
    required: false,
    defaultValue: "blocking",
    allowedValues: ["blocking", "advisory"],
    description: "Default gate enforcement."
  },
  {
    path: "execution.enforcement.fail_fast",
    type: "boolean",
    required: false,
    defaultValue: "false",
    description: "Whether scheduling stops after the first blocking failure."
  },
  {
    path: "execution.enforcement.minimum_evidence_coverage_percent",
    type: "number 0..100",
    required: false,
    description: "Minimum valid evidence coverage."
  },
  {
    path: "execution.enforcement.missing_blocking_evidence",
    type: "string",
    required: false,
    allowedValues: ["fail", "inconclusive"],
    description: "Blocking no-data policy."
  },
  {
    path: "execution.enforcement.provider_unavailable",
    type: "string",
    required: false,
    allowedValues: ["fail"],
    description: "Provider failure policy."
  },
  {
    path: "execution.enforcement.unsupported_gate",
    type: "string",
    required: false,
    allowedValues: ["fail"],
    description: "Unsupported capability policy."
  },
  {
    path: "execution.clock.maximum_clock_skew",
    type: "duration",
    required: false,
    description: "Allowed evidence clock skew."
  },
  {
    path: "identity.canonical.service_name",
    type: "string",
    required: true,
    description: "Canonical OTel service.name."
  },
  {
    path: "identity.canonical.service_namespace",
    type: "string",
    required: true,
    description: "Canonical OTel service.namespace."
  },
  {
    path: "identity.canonical.environment",
    type: "string",
    required: true,
    description: "Canonical deployment.environment.name."
  },
  {
    path: "identity.canonical.release_id",
    type: "string",
    required: true,
    description: "Candidate service.version."
  },
  {
    path: "identity.canonical.deployment_id",
    type: "string",
    required: true,
    description: "Deployment correlation ID."
  },
  {
    path: "identity.required_resource_attributes[]",
    type: "string",
    required: false,
    description: "Required OTel resource keys."
  },
  {
    path: "identity.recommended_resource_attributes[]",
    type: "string",
    required: false,
    description: "Recommended OTel resource keys."
  },
  {
    path: "identity.provider_mappings.<signal>.*",
    type: "string",
    required: false,
    description: "Provider-specific identity mapping."
  },
  {
    path: "release.candidate.id",
    type: "string",
    required: true,
    description: "Candidate release ID."
  },
  {
    path: "release.candidate.deployed_at",
    type: "RFC 3339 string",
    required: false,
    description: "Deployment completion time."
  },
  {
    path: "release.candidate.minimum_age_before_evaluation",
    type: "duration",
    required: false,
    description: "Minimum candidate age."
  },
  {
    path: "release.candidate.maximum_age_before_evaluation",
    type: "duration",
    required: false,
    description: "Maximum candidate age."
  },
  {
    path: "release.baseline.strategy",
    type: "string",
    required: false,
    description: "Baseline selection strategy."
  },
  {
    path: "release.baseline.explicit_release_id",
    type: "string",
    required: false,
    description: "Explicit baseline release."
  },
  {
    path: "release.baseline.lookback",
    type: "duration",
    required: false,
    description: "Baseline search window."
  },
  {
    path: "release.baseline.minimum_samples",
    type: "non-negative integer",
    required: false,
    description: "Minimum baseline samples."
  },
  {
    path: "release.comparison.method",
    type: "string",
    required: false,
    description: "Regression comparison method."
  },
  {
    path: "release.comparison.minimum_candidate_samples",
    type: "non-negative integer",
    required: false,
    description: "Minimum candidate samples."
  },
  {
    path: "release.comparison.low_traffic_behavior",
    type: "string",
    required: false,
    allowedValues: ["extend_then_inconclusive"],
    description: "Low-traffic behavior."
  },
  {
    path: "release.comparison.maximum_extension",
    type: "duration",
    required: false,
    description: "Maximum sampling extension."
  },
  {
    path: "observation.pre_deployment.current_health_window",
    type: "duration",
    required: false,
    description: "Pre-deployment health window."
  },
  {
    path: "observation.pre_deployment.current_health_offset",
    type: "duration",
    required: false,
    description: "Pre-deployment query offset."
  },
  {
    path: "observation.pre_deployment.evidence_max_age",
    type: "duration",
    required: false,
    description: "Maximum pre-deployment evidence age."
  },
  {
    path: "observation.post_deployment.warmup",
    type: "duration",
    required: false,
    description: "Candidate warmup."
  },
  {
    path: "observation.post_deployment.evaluation_window",
    type: "duration",
    required: false,
    description: "Candidate evaluation window."
  },
  {
    path: "observation.post_deployment.step",
    type: "duration",
    required: false,
    description: "Range-query step."
  },
  {
    path: "observation.post_deployment.settle_between_samples",
    type: "duration",
    required: false,
    description: "Sampling interval."
  },
  {
    path: "observation.post_deployment.minimum_successful_samples",
    type: "non-negative integer",
    required: false,
    description: "Successful sample target."
  },
  {
    path: "observation.post_deployment.maximum_evidence_age",
    type: "duration",
    required: false,
    description: "Maximum post-deployment evidence age."
  },
  {
    path: "observation.no_data.blocking_gate",
    type: "string",
    required: false,
    allowedValues: ["fail", "inconclusive"],
    description: "Blocking no-data behavior."
  },
  {
    path: "observation.no_data.advisory_gate",
    type: "string",
    required: false,
    allowedValues: ["warn"],
    description: "Advisory no-data behavior."
  },
  {
    path: "decision.outcomes.<decision>.exit_code",
    type: "integer 0..255",
    required: true,
    description: "CLI exit code."
  },
  {
    path: "decision.outcomes.<decision>.conclusion",
    type: "string",
    required: true,
    description: "CI conclusion."
  },
  {
    path: "targets.definitions.<id>.runtime",
    type: "object",
    required: true,
    description: "Runtime-specific target settings."
  },
  {
    path: "providers.<family>.<id>",
    type: "object",
    required: false,
    description: "Named read-only provider configuration."
  },
  {
    path: "gate_defaults.enabled",
    type: "boolean",
    required: false,
    defaultValue: "true",
    description: "Default enabled state."
  },
  {
    path: "gate_defaults.enforcement",
    type: "enum",
    required: false,
    defaultValue: "blocking",
    allowedValues: ["blocking", "advisory"],
    description: "Default gate enforcement."
  },
  {
    path: "gate_defaults.timeout",
    type: "duration",
    required: false,
    defaultValue: "60s",
    description: "Per-gate timeout."
  },
  {
    path: "gates.<phase>[]",
    type: "gate object",
    required: true,
    description: "Ordered phase gate definitions."
  },
  {
    path: "reporting.github",
    type: "object",
    required: false,
    description: "GitHub publication settings."
  },
  {
    path: "reporting.artifacts",
    type: "object",
    required: false,
    description: "Local artifact settings."
  },
  {
    path: "reporting.outputs[]",
    type: "string",
    required: false,
    description: "Published Action outputs."
  },
  {
    path: "reporting.links.*",
    type: "environment variable name",
    required: false,
    description: "User-facing link source."
  },
  {
    path: "security.read_only",
    type: "boolean",
    required: false,
    defaultValue: "true",
    description: "Read-only contract."
  },
  {
    path: "security.prohibited_operations[]",
    type: "string",
    required: false,
    description: "Explicit mutation prohibitions."
  },
  {
    path: "limits.maximum_gates",
    type: "positive integer",
    required: false,
    description: "Gate count ceiling."
  },
  {
    path: "limits.maximum_queries",
    type: "positive integer",
    required: false,
    description: "Query count ceiling."
  },
  {
    path: "limits.maximum_total_runtime",
    type: "duration",
    required: false,
    description: "Execution ceiling."
  },
  {
    path: "limits.maximum_parallel_requests_per_provider",
    type: "positive integer",
    required: false,
    defaultValue: "4",
    description: "Per-provider concurrency ceiling."
  },
  {
    path: "limits.maximum_provider_response_size",
    type: "size",
    required: false,
    description: "Provider response size ceiling."
  },
  {
    path: "limits.maximum_report_size",
    type: "size",
    required: false,
    description: "Total report size ceiling."
  }
]);
