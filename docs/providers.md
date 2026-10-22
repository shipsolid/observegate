# Provider reference

Providers acquire and normalize evidence only. They do not deploy, scale,
restart, change traffic, or mutate observability resources. Network providers
share guarded HTTPS transport, bounded response sizes, explicit retry policies,
cancellation, and SSRF controls.

| Family   | Implementation       | Capabilities                                                                      | Authentication                                   | Read-only |
| -------- | -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| metrics  | Prometheus           | instant query, range query                                                        | bearer/basic headers from environment            | yes       |
| metrics  | Mimir                | instant query, range query                                                        | bearer/basic headers from environment            | yes       |
| logs     | Loki                 | range query, correlation search                                                   | bearer/basic headers from environment            | yes       |
| traces   | Tempo                | trace search, service identity                                                    | bearer/basic headers from environment            | yes       |
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

## Provider failure semantics

- Authentication and authorization failures are not retried.
- Only configured transient timeouts, connection resets, 429, 502, 503, and 504
  responses retry.
- Required provider failure yields an `error` decision; absence of evidence is
  classified separately.
- Identical evidence requests are deduplicated in memory for one execution.
