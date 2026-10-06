# Security model

ObserveGate is a read-only, ephemeral CLI and GitHub Action. It stores no backend state and never
deploys, rolls back, changes traffic, scales workloads, restarts services, or mutates Grafana,
Kubernetes, or Azure resources.

## Trust boundaries

| Boundary            | Control                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Policy YAML         | Strict schema, duplicate-key rejection, no aliases/merge keys, 2 MiB limit.                                         |
| Environment         | Variable names in YAML; values are interpolated only into the active target/phase and redacted from output.         |
| Workspace files     | Canonical real-path containment, symlink escape rejection, regular-file and size checks.                            |
| Provider network    | HTTPS policy, DNS/IP checks, private/loopback/link-local/metadata rejection, guarded redirects and response limits. |
| Queries             | Length/range limits and provider-specific validation; raw queries are not printed.                                  |
| Deployment evidence | Asymmetric compact JWS, guarded JWKS, provenance/freshness/clock-skew validation.                                   |
| Reports             | Explicit DTOs, no raw provider bodies, bounded size, same-directory atomic rename.                                  |

## Prohibited capabilities

- Shell or child-process execution.
- Dynamic plugins or code loading.
- SSH, WinRM, PowerShell remoting, or remote guest commands.
- Kubernetes mutation methods.
- Azure create, update, delete, action, or traffic-changing methods.
- Automatic deployment, rollback, scaling, restart, or alert/dashboard mutation.

## Least privilege

- Kubernetes: namespace-scoped `get`/`list` for selected workloads, Pods, ReplicaSets, and Events.
- Azure: Reader at the narrowest resource scope, preferably via GitHub OIDC.
- Grafana: read scopes for dashboards, alerting, and SLOs; no write token is required for evaluation.
- GitHub: `contents: read`; add `id-token: write`, `checks: write`, or `pull-requests: write` only for explicitly enabled features.

Cancellation propagates to retries, requests, warmup, gates, report writes, and Action signal
handlers. A cancelled partial run is always `error`, never `pass`.
