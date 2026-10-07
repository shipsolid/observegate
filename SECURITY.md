# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities through this repository's private GitHub Security Advisory flow.
Do not open a public issue with exploit details, credentials, policy files, provider responses, or
release evidence. Include the affected commit or release, reproduction steps, expected impact, and
whether the issue can expose secrets or cause an incorrect deployment decision.

The maintainers will acknowledge the report, assess affected releases, coordinate remediation, and
publish an advisory when users can safely upgrade. General bugs that do not create a security impact
belong in the public issue tracker.

## Supported artifacts

Security fixes target the latest published release and the current `main` branch. Supported release
artifacts are:

- The GitHub Action at an immutable full commit SHA.
- The `observegate-cli-<tag>.tar.gz` asset attached to a release.
- The matching CycloneDX SBOM and SHA-256 checksum file.
- GitHub build-provenance and SBOM attestations for the CLI archive.

Verify the checksum before execution and verify the attestation with GitHub CLI:

```bash
sha256sum --check observegate-v1.0.0.sha256
gh attestation verify observegate-cli-v1.0.0.tar.gz --repo shipsolid/observegate
```

Tags alone are not a sufficient production pin for the Action. Release archives from forks or
unattested rebuilds are outside the supported artifact boundary.

## Secret handling

- Pass credentials through the CI secret store or runtime environment; never commit them to policy,
  fixtures, reports, or workflow inputs.
- Provider credentials are used only to create scoped read-only clients. They are not part of
  evidence fingerprints, plans, or reports.
- Reports retain normalized evidence references and safe diagnostics, not raw provider payloads.
- Known secret keys, bearer tokens, and URL query strings are redacted before diagnostic output.
- Use least-privilege data-plane readers and short-lived identity federation where supported.

Treat generated JSON, Markdown, JUnit, SARIF, and workflow logs as potentially sensitive operational
metadata even after redaction.

## Threat boundary

ObserveGate parses repository-controlled YAML and local evidence files, then performs bounded
read-only queries against explicitly configured providers. URL allowlists, HTTPS enforcement,
private-address rejection, response-size limits, timeouts, cancellation, file path confinement, and
strict schemas reduce SSRF, traversal, resource-exhaustion, and injection risk.

The trusted boundary still includes the runner, checked-out repository, configured DNS resolver,
provider identities, trusted deployment-signing keys, and GitHub Actions supply chain. A compromised
runner or read credential can expose everything that identity can read. Policy authors must review
provider endpoints, allowlists, signing issuers, audiences, and evidence freshness limits.

## No backend and no mutation guarantee

ObserveGate has no hosted backend, control plane, persistent evidence database, or telemetry upload
service. Evidence lives in process memory for one run and reports are written only to the requested
workspace directory.

Production code does not deploy, roll back, scale, restart, shift traffic, execute a shell, open SSH
or WinRM sessions, or call Kubernetes/Azure mutation APIs. CI enforces this boundary with
`npm run verify:read-only`. A finding can block a deployment through its exit status, but ObserveGate
does not perform the deployment or remediation itself.
