# Configuration reference

ObserveGate accepts one strict YAML policy with no top-level schema-version
field. Unknown fields, duplicate keys, YAML aliases, and merge keys are
rejected. Interpolation supports only `${VARIABLE_NAME}` and is limited to the
active target and selected phase.

Durations use `ms`, `s`, `m`, `h`, or `d`. Secrets must come from environment
variables, OIDC, or ambient identity; never place credential values in the
policy.

Use `observability-gate schema --json` or the generated
[policy JSON Schema](observability-gate.schema.json) for editor validation.
Runtime validation additionally checks references, acquisition contracts,
supported semantic values, and workspace/network security; structural schema
validation alone is insufficient.

| Field path                                                   | Type                      | Required | Default          | Allowed values                   | Meaning                                                             |
| ------------------------------------------------------------ | ------------------------- | -------- | ---------------- | -------------------------------- | ------------------------------------------------------------------- |
| metadata.name                                                | string                    | yes      | —                | —                                | Policy name.                                                        |
| metadata.description                                         | string                    | no       | —                | —                                | Policy purpose.                                                     |
| metadata.owner                                               | string                    | no       | —                | —                                | Owning team.                                                        |
| metadata.service_tier                                        | string                    | no       | —                | —                                | Service criticality tier.                                           |
| metadata.tags.*                                              | string                    | no       | —                | —                                | Low-cardinality policy tags.                                        |
| execution.active_target                                      | string                    | yes      | —                | —                                | Target selected for execution.                                      |
| execution.environment_substitution.syntax                    | string                    | no       | ${VARIABLE_NAME} | —                                | Environment interpolation syntax.                                   |
| execution.environment_substitution.scope                     | string                    | no       | —                | active_target_and_selected_phase | Interpolation scope.                                                |
| execution.environment_substitution.missing_required_variable | string                    | no       | —                | error                            | Missing variable behavior.                                          |
| execution.environment_substitution.allow_default_values      | boolean                   | no       | false            | —                                | Whether inline defaults are permitted.                              |
| execution.phases.<phase>.timeout                             | duration                  | yes      | —                | —                                | Overall phase deadline.                                             |
| execution.phases.<phase>.concurrency                         | positive integer          | yes      | 8                | —                                | Maximum concurrent gates.                                           |
| execution.retries.attempts                                   | non-negative integer      | no       | —                | —                                | Maximum retry attempts.                                             |
| execution.retries.initial_backoff                            | duration                  | no       | —                | —                                | Initial retry delay.                                                |
| execution.retries.maximum_backoff                            | duration                  | no       | —                | —                                | Retry delay ceiling.                                                |
| execution.retries.retry_on[]                                 | string                    | no       | —                | —                                | Retryable transport conditions.                                     |
| execution.enforcement.default                                | enum                      | no       | blocking         | blocking, advisory               | Default gate enforcement.                                           |
| execution.enforcement.fail_fast                              | boolean                   | no       | false            | —                                | Whether scheduling stops after the first blocking failure.          |
| execution.enforcement.minimum_evidence_coverage_percent      | number 0..100             | no       | —                | —                                | Minimum valid evidence coverage.                                    |
| execution.enforcement.missing_blocking_evidence              | string                    | no       | —                | fail, inconclusive               | Blocking no-data policy.                                            |
| execution.enforcement.provider_unavailable                   | string                    | no       | —                | fail                             | Provider failure policy.                                            |
| execution.enforcement.unsupported_gate                       | string                    | no       | —                | fail                             | Unsupported capability policy.                                      |
| execution.clock.maximum_clock_skew                           | duration                  | no       | —                | —                                | Allowed evidence clock skew.                                        |
| identity.canonical.service_name                              | string                    | yes      | —                | —                                | Canonical OTel service.name.                                        |
| identity.canonical.service_namespace                         | string                    | yes      | —                | —                                | Canonical OTel service.namespace.                                   |
| identity.canonical.environment                               | string                    | yes      | —                | —                                | Canonical deployment.environment.name.                              |
| identity.canonical.release_id                                | string                    | yes      | —                | —                                | Candidate service.version.                                          |
| identity.canonical.deployment_id                             | string                    | yes      | —                | —                                | Deployment correlation ID.                                          |
| identity.required_resource_attributes[]                      | string                    | no       | —                | —                                | Required OTel resource keys.                                        |
| identity.recommended_resource_attributes[]                   | string                    | no       | —                | —                                | Recommended OTel resource keys.                                     |
| identity.provider_mappings.<signal>.*                        | string                    | no       | —                | —                                | Provider-specific identity mapping.                                 |
| release.candidate.id                                         | string                    | yes      | —                | —                                | Candidate release ID.                                               |
| release.candidate.deployed_at                                | RFC 3339 string           | no       | —                | —                                | Deployment completion time.                                         |
| release.candidate.minimum_age_before_evaluation              | duration                  | no       | —                | —                                | Minimum candidate age.                                              |
| release.candidate.maximum_age_before_evaluation              | duration                  | no       | —                | —                                | Maximum candidate age.                                              |
| release.baseline.strategy                                    | string                    | no       | —                | explicit                         | Explicit baseline only; automatic discovery is unsupported.         |
| release.baseline.explicit_release_id                         | string                    | no       | —                | —                                | Required baseline release ID when the baseline block is configured. |
| release.baseline.minimum_samples                             | non-negative integer      | no       | —                | —                                | Minimum baseline samples.                                           |
| release.comparison.method                                    | string                    | no       | —                | relative_and_absolute            | Compare relative and absolute regression limits.                    |
| release.comparison.minimum_candidate_samples                 | non-negative integer      | no       | —                | —                                | Minimum candidate samples.                                          |
| release.comparison.low_traffic_behavior                      | string                    | no       | —                | inconclusive                     | Low-traffic behavior.                                               |
| release.comparison.maximum_extension                         | duration                  | no       | —                | 0s                               | Automatic low-traffic extension is unsupported; must be 0s.         |
| observation.pre_deployment.current_health_window             | duration                  | no       | —                | —                                | Pre-deployment health window.                                       |
| observation.pre_deployment.current_health_offset             | duration                  | no       | —                | —                                | Pre-deployment query offset.                                        |
| observation.pre_deployment.evidence_max_age                  | duration                  | no       | —                | —                                | Maximum pre-deployment evidence age.                                |
| observation.post_deployment.warmup                           | duration                  | no       | —                | —                                | Candidate warmup.                                                   |
| observation.post_deployment.evaluation_window                | duration                  | no       | —                | —                                | Candidate evaluation window.                                        |
| observation.post_deployment.step                             | duration                  | no       | —                | —                                | Range-query step.                                                   |
| observation.post_deployment.settle_between_samples           | duration                  | no       | —                | —                                | Sampling interval.                                                  |
| observation.post_deployment.minimum_successful_samples       | non-negative integer      | no       | —                | —                                | Successful sample target.                                           |
| observation.post_deployment.maximum_evidence_age             | duration                  | no       | —                | —                                | Maximum post-deployment evidence age.                               |
| observation.no_data.blocking_gate                            | string                    | no       | —                | fail, inconclusive               | Blocking no-data behavior.                                          |
| observation.no_data.advisory_gate                            | string                    | no       | —                | warn                             | Advisory no-data behavior.                                          |
| decision.outcomes.<decision>.exit_code                       | integer 0..255            | yes      | —                | —                                | CLI exit code.                                                      |
| decision.outcomes.<decision>.conclusion                      | string                    | yes      | —                | —                                | CI conclusion.                                                      |
| targets.definitions.<id>.runtime                             | object                    | yes      | —                | —                                | Runtime-specific target settings.                                   |
| providers.<family>.<id>                                      | object                    | no       | —                | —                                | Named read-only provider configuration.                             |
| gate_defaults.enabled                                        | boolean                   | no       | true             | —                                | Default enabled state.                                              |
| gate_defaults.enforcement                                    | enum                      | no       | blocking         | blocking, advisory               | Default gate enforcement.                                           |
| gate_defaults.timeout                                        | duration                  | no       | 60s              | —                                | Per-gate timeout.                                                   |
| gates.<phase>[]                                              | gate object               | yes      | —                | —                                | Ordered phase gate definitions.                                     |
| reporting.github                                             | object                    | no       | —                | —                                | GitHub publication settings.                                        |
| reporting.artifacts                                          | object                    | no       | —                | —                                | Local artifact settings.                                            |
| reporting.outputs[]                                          | string                    | no       | —                | —                                | Published Action outputs.                                           |
| reporting.links.*                                            | environment variable name | no       | —                | —                                | User-facing link source.                                            |
| security.read_only                                           | boolean                   | no       | true             | —                                | Read-only contract.                                                 |
| security.prohibited_operations[]                             | string                    | no       | —                | —                                | Explicit mutation prohibitions.                                     |
| limits.maximum_gates                                         | positive integer          | no       | —                | —                                | Gate count ceiling.                                                 |
| limits.maximum_queries                                       | positive integer          | no       | —                | —                                | Query count ceiling.                                                |
| limits.maximum_total_runtime                                 | duration                  | no       | —                | —                                | Execution ceiling.                                                  |
| limits.maximum_parallel_requests_per_provider                | positive integer          | no       | 4                | —                                | Per-provider concurrency ceiling.                                   |
| limits.maximum_provider_response_size                        | size                      | no       | —                | —                                | Provider response size ceiling.                                     |
| limits.maximum_report_size                                   | size                      | no       | —                | —                                | Total report size ceiling.                                          |
