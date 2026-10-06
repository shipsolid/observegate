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

## Provider failure semantics

- Authentication and authorization failures are not retried.
- Only configured transient timeouts, connection resets, 429, 502, 503, and 504
  responses retry.
- Required provider failure yields an `error` decision; absence of evidence is
  classified separately.
- Identical evidence requests are deduplicated in memory for one execution.
