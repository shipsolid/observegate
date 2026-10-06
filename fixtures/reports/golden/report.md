# Observability Gate

**Decision:** fail

- Phase: post_deployment
- Target: production (kubernetes, aks)
- Release: checkout-2026.10.6
- Baseline release: checkout-2026.10.5
- Evidence coverage: 92.5%

## Gates

### release.error-rate — failed

- Enforcement: blocking
- error_rate: observed 0.04 ratio; expected 0.01 ratio; window 10m, 500 samples — Error rate exceeded
- Evidence: prometheus.range from metrics, 5s old
- EVIDENCE_INVALID: Threshold breached
- Remediation: Inspect the candidate release.

### policy.sarif — warned

- Enforcement: advisory
- EVIDENCE_INVALID: Unsafe instrumentation setting

## Links

- [dashboard](https://example.invalid/dashboard)
- [runbook](https://example.invalid/runbook)
