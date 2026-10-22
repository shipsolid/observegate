# Provider reference

Providers acquire and normalize evidence only. They do not deploy, scale,
restart, change traffic, or mutate observability resources. Network providers
share guarded HTTPS transport, bounded response sizes, explicit retry policies,
cancellation, and SSRF controls.

| Family   | Implementation       | Capabilities                                                                      | Authentication                                   | Read-only |
| -------- | -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| metrics  | Prometheus           | instant query, range query                                                        | bearer token from environment                    | yes       |
| metrics  | Mimir                | instant query, range query                                                        | bearer token from environment                    | yes       |
| logs     | Loki                 | range query, correlation search                                                   | bearer token from environment                    | yes       |
| traces   | Tempo                | trace search, service identity                                                    | bearer token from environment                    | yes       |
| grafana  | Grafana Cloud        | dashboard read, alert rule read, notification route read, SLO read                | service-account/API token from environment       | yes       |
| grafana  | Grafana              | dashboard read, alert rule read, notification route read, SLO read                | service-account/API token from environment       | yes       |
| runtime  | Kubernetes           | workload snapshot, pod snapshot, event read, manifest parse                       | ambient or kubeconfig                            | yes       |
| runtime  | AKS                  | workload snapshot, pod snapshot, event read, manifest parse                       | ambient or kubeconfig                            | yes       |
| runtime  | Azure Container Apps | application read, revision read, replica read, manifest parse                     | Azure workload identity/ambient credential       | yes       |
| runtime  | Azure VM             | VM instance view, power state, host evidence join                                 | Azure workload identity/ambient credential       | yes       |
| runtime  | Linux VM             | bounded host evidence, service state, release marker, telemetry agent health      | signed workspace evidence files; no SSH or WinRM | yes       |
| runtime  | Windows VM           | bounded host evidence, service state, release marker, telemetry agent health      | signed workspace evidence files; no SSH or WinRM | yes       |
| evidence | workspace files      | SARIF, OTLP contract, deployment attestation, synthetic results, incident windows | workspace boundary and optional compact JWS/JWKS | yes       |
| http     | guarded probe        | HTTP status, latency, TLS                                                         | configured environment headers                   | yes       |

## Configuring acquisition

Use `observability-gate explain <gate-type> --json` for each gate's accepted
source and assertion fields. Both `validate` and `plan` reject incomplete
acquisition contracts without contacting providers. The exhaustive reference
YAML demonstrates policy structure; it must be completed with workload-specific
queries, artifacts, and identities. Start with `examples/offline.yml` for a
runnable local policy.

- Telemetry providers use canonical keys `metrics`, `logs`, `traces`, and
  `grafana`; provider types must match those capabilities.
- Metric assertions require explicit backend queries. Traffic counts and
  baseline/candidate measurements require independent queries; vector length is
  never treated as request volume. Scalar contracts require one finite series;
  range contracts evaluate the actual returned samples.
- Comparison sources require distinct candidate and baseline release IDs and
  explicit queries for each. Supply an explicit baseline release rather than
  assuming that the backend can discover a previous healthy release.
- Baseline strategy is `explicit`; automatic release discovery, lookback
  filtering, incident/deployment exclusions, and automatic low-traffic extension
  are unsupported and reject instead of being ignored. Scalar instant
  comparisons contribute one sample per query; request counts require
  independent count queries.
- Cardinality estimates require one `source.queries` entry per configured
  dimension: `new_metric_series`, `new_log_attribute_keys`,
  `new_span_attribute_keys`, or `estimated_series_growth_percent`. Volume
  estimates use `metrics`, `logs`, and `traces` growth percentages. Counts are
  non-negative integers; percentages are non-negative finite numbers. These
  gates are advisory.
- Grafana alert readiness reads provisioned configuration and runbook
  annotations, while active-alert state comes from a separate endpoint. SLO
  definitions use one objective and key/value labels; SLO health and remaining
  budget require measured `source.queries.status` (1=met, 0=unmet) and
  `remaining_percent`. Indicator validation supports ratio/freeform definitions
  with an explicit datasource UID.
- Notification routes resolve nested/default/inherited receivers and continue
  branches. Regex/legacy matchers, unknown selector labels, and recurring
  mute/active schedules yield insufficient evidence until supported; an
  unresolved schedule cannot prove the deployment window is unmuted.
- Runtime gates require a compatible active target. Kubernetes uses one
  kubeconfig (including a configured `authentication.kubeconfig_env`) or an
  in-cluster service account; command-based credential plugins and disabled TLS
  verification are rejected. Azure uses environment, workload, or managed
  identity credentials.
- VM guest facts require `runtime.expected_hosts` and workspace-contained JSON
  files in `runtime.artifacts.runtime_evidence`; Azure control-plane state does
  not prove guest service health.
- Container Apps lifecycle and restart checks require explicit telemetry
  queries. A revision snapshot alone cannot establish historical restart or
  stability assertions.
- Signed deployment evidence requires a compact JWS, trusted workspace JWKS,
  compatible algorithm/key, exact release identity, and fresh deployment
  completion. See [deployment evidence](deployment-evidence.md).

## Compatibility evidence

| Provider                | Contract exercised locally                                                                                              | Live certification                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Prometheus/Mimir        | v1 query/query_range vector and matrix shapes; malformed/stale/failure cases                                            | Not run in this checkout                                                                             |
| Loki                    | v1 query_range stream shape and bounded requests                                                                        | Not run in this checkout                                                                             |
| Tempo                   | Bounded trace search and identity-object contract                                                                       | Not run in this checkout                                                                             |
| Grafana                 | Documented alert provisioning, dashboard, routing/contact-point and SLO definition shapes; explicit reliability queries | Not run in this checkout                                                                             |
| Kubernetes              | apps/v1 Deployment, StatefulSet, DaemonSet; policy/v1 PDB selectors; multi-container evidence                           | Local kind Kubernetes v1.37.0: three real API/rollout cases passed; AKS certification still required |
| Azure Container Apps/VM | Pinned SDK read adapters and synthetic response contracts                                                               | Protected opt-in Azure job; no live certification recorded here                                      |
| Linux/Windows VMs       | Bounded workspace guest evidence plus signed deployment identity                                                        | User-owned collection; no host sessions                                                              |

These are contract tests, not an assertion that all deployed vendor versions are
compatible. Run the protected live jobs against the exact release and versions
before declaring an environment supported.

## Provider failure semantics

- Authentication and authorization failures are not retried.
- Only configured transient timeouts, connection resets, 429, 502, 503, and 504
  responses retry.
- Required provider failure yields an `error` decision; absence of evidence is
  classified separately.
- Identical evidence requests are deduplicated in memory for one execution.
