# ObserveGate

ObserveGate is a read-only TypeScript CLI and GitHub Action that turns observability, runtime, and
release evidence into deterministic pre- and post-deployment decisions.

## What it does

- Loads one strict `observability-gate.yml` policy for both deployment phases.
- Evaluates 86 reference-policy gate instances across readiness, change risk, telemetry identity,
  release health, regression, reliability, Kubernetes, Azure Container Apps, and VM runtimes.
- Reads Prometheus/Mimir, Loki, Tempo, Grafana, Kubernetes, Azure, HTTP, and signed file evidence.
- Produces canonical JSON, Markdown, JUnit, and SARIF reports.
- Returns the same decision model through the CLI and Action.

ObserveGate does not deploy, roll back, scale, restart, change traffic, execute a shell, use
SSH/WinRM, or mutate observability resources.

## Decision contract

| Decision | Meaning | CLI exit | GitHub step |
| --- | --- | ---: | --- |
| `pass` | Every applicable blocking gate passed. | 0 | success |
| `warn` | Blocking gates passed; advisory/skipped findings exist. | 0 | success/neutral report |
| `fail` | A blocking assertion or evidence-coverage requirement failed. | 1 | failure |
| `inconclusive` | Required evidence cannot support a decision. | 2 | failure |
| `error` | Provider, execution, reporting, or cancellation failure. | 3 | failure |

Every blocking non-pass blocks deployment.

## GitHub Action

Pin the Action to a full commit SHA in production:

```yaml
- name: Pre-deployment observability gate
  uses: shipsolid/observegate@cb515c72d282c13dccb26fc4c7ff32505d3d0a40
  with:
    config: observability-gate.yml
    phase: pre_deployment
    output-directory: observability-gate-results/pre
  env:
    TARGET_ID: aks-checkout
    SERVICE_NAME: checkout
    SERVICE_NAMESPACE: commerce
    ENVIRONMENT: production
    RELEASE_ID: ${{ github.sha }}
    DEPLOYMENT_ID: ${{ github.run_id }}
```

See the complete [pre/deploy/post workflow](examples/workflows/pre-and-post.yml).

## CLI

Requires Node.js 24.

```bash
npm ci
npm run build
node packages/cli/dist/main.js validate --config examples/observability-gate.yml
node packages/cli/dist/main.js plan --config examples/observability-gate.yml --phase pre_deployment
node packages/cli/dist/main.js run --config examples/observability-gate.yml --phase post_deployment --output-directory observability-gate-results
node packages/cli/dist/main.js explain telemetry.release_identity
node packages/cli/dist/main.js catalog --json
```

`validate` and `plan` do not contact providers. Standard output is user-facing; diagnostics go to
standard error. Plans omit credentials, gate definitions, and raw queries.

Published releases also include a self-contained CLI archive, CycloneDX SBOM, checksums, and GitHub
attestations. After downloading the three release assets:

```bash
sha256sum --check observegate-v1.0.0.sha256
gh attestation verify observegate-cli-v1.0.0.tar.gz --repo shipsolid/observegate
mkdir observegate-cli
tar -xzf observegate-cli-v1.0.0.tar.gz -C observegate-cli
node observegate-cli/observegate.js catalog
```

Replace `v1.0.0` with the release tag. The archive has no production npm dependencies; Node.js 24
is the only runtime requirement.

## Configuration and operations

- [Configuration reference](docs/configuration.md)
- [Gate catalogue](docs/gates.md)
- [Provider reference](docs/providers.md)
- [Telemetry identity](docs/telemetry-identity.md)
- [OTLP contract evidence](docs/otlp-contract.md)
- [Deployment evidence](docs/deployment-evidence.md)
- [Security model](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- Runtime guides: [Kubernetes/AKS](docs/runtimes/kubernetes.md),
  [Azure Container Apps](docs/runtimes/azure-container-apps.md),
  [Azure VM](docs/runtimes/azure-vm.md), [Linux VM](docs/runtimes/linux-vm.md), and
  [Windows VM](docs/runtimes/windows-vm.md)

The complete policy is [examples/observability-gate.yml](examples/observability-gate.yml).

## Development

```bash
npm ci
npm run ci
npm run docs:generate
npm run test:e2e
npm run test:security
npm run test:property
npm run test:mutation
npm run test:performance
npm run bundle
npm run verify:bundle
npm run verify:read-only
```

Generated configuration, gate, provider, and error-code tables are checked for drift in contract
tests. `npm run bundle` rebuilds the checked-in Action and the standalone CLI under `dist/cli`; both
must pass bundle and read-only verification without producing uncommitted Action changes.

See [CONTRIBUTING.md](CONTRIBUTING.md) for extension contracts and [SECURITY.md](SECURITY.md) for
vulnerability reporting, artifact verification, and the trust boundary.

## Architecture

The monorepo keeps dependency direction acyclic:

```text
core <- config
core <- gates
core <- providers
core <- reporters
config + gates + providers + reporters <- cli/action composition
```

Evidence is normalized before evaluation, deduplicated in one in-memory store per run, bounded by
global and per-provider concurrency, and discarded when execution ends. There is no ObserveGate
backend or persistent evidence database.

## License

[Apache License 2.0](LICENSE).
