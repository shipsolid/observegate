# ObserveGate product completeness review

**Updated:** 22 October 2026 (IST)
**Scope:** CLI, GitHub Action, configuration, evidence acquisition, all 68 registered gate types,
decision integrity, security, reports, onboarding, and release automation.
**Baseline:** `50506d325ab52cea701876c6b6e68e881ff982f0`; findings and acceptance criteria are preserved
in the [original audit backlog](product-audit-gaps.md).

## Assessment

**The 26 audited repository gaps have been addressed in code, documentation, and local validation.**
ObserveGate now has default acquisition paths for all 68 gate types, shared CLI/Action policy
translation, strict acquisition validation, and representative healthy/unhealthy public workflows.
The source and checked-in Action bundle are rebuilt together.

This establishes local implementation completeness against the audit, not live platform certification.
A supervised pilot should use an explicitly validated workload policy and verify its exact backend,
permissions, queries, identity labels, observation window, and signed evidence. General production
rollout still requires the environment checks below.

| Measure                             | Original review                                    | After remediation                                                                                               |
| ----------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Registered gate acquisition routes  | 19 of 68; 49 missing                               | 68 of 68 exercised with real normalizers and raw protocol/SDK fixtures                                          |
| Platform/runtime composition        | Platform adapters disconnected                     | Kubernetes, Container Apps, Azure VM, Linux VM, Windows VM connected                                            |
| Public composition tests            | Service/provider overrides obscured default wiring | Healthy and unhealthy CLI + Action cases across ten provider/runtime families                                   |
| Statement coverage                  | 87.05%                                             | 89.86% at the full verification run; see validation record                                                      |
| Action service statement coverage   | 0%                                                 | 90.90%                                                                                                          |
| Provider session statement coverage | 31.33%                                             | 91.42%                                                                                                          |
| Shipped Action source parity        | Stale                                              | Rebuilt; repeated build hashes checked                                                                          |
| Release reproducibility             | Same directory archived twice                      | Independent locked installs and clean builds; byte comparisons include CLI archive and normalized SBOM metadata |

Route coverage is not a claim that every possible policy permutation or remote platform version has
been tested. The exhaustive reference YAML remains a byte-stable structural reference; workload
queries, artifacts, and explicit source contracts must be supplied before execution. The runnable
starting point is [examples/offline.yml](../examples/offline.yml).

## Audit closure

“Closed locally” means the implementation and deterministic regression coverage are present.
The original IDs retain their original meaning; no finding was removed from the backlog to achieve closure.

| ID           | Status         | Implemented behavior and evidence                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OG-AUDIT-001 | Closed locally | Default provider session composes every registered gate family. Offline acquisition validation rejects incomplete or incompatible selected gates. [Resolvers](../packages/providers/src/resolvers), [catalog acquisition tests](../tests/end-to-end/default-composition-catalog.test.ts).                                                                                                                      |
| OG-AUDIT-002 | Closed locally | Canonical mapped IPv4/IPv6 classification and validated DNS answers pinned to the actual HTTPS socket, preserving hostname certificate verification. [Transport](../packages/providers/src/transport), transport policy/pinning regressions.                                                                                                                                                                   |
| OG-AUDIT-003 | Closed locally | Cancellation and deadlines cover DNS, redirects, body reads, retries, and cleanup. [Guarded transport](../packages/providers/src/transport/guarded-fetch.ts), deadline and hanging-operation tests.                                                                                                                                                                                                            |
| OG-AUDIT-004 | Closed locally | Nested provider, runtime, authentication, gate source/assertion, reporting, and security validation; accepted enums and supported acquisition contracts checked offline. [Contract validation](../packages/config/src/schema/validate-contract.ts), [negative validation tests](../packages/config/test/completeness.test.ts).                                                                                 |
| OG-AUDIT-005 | Closed locally | Quoted query literals retain their semantics in evidence fingerprints; tracked Action artifacts rebuilt from source. [Fingerprint](../packages/core/src/evidence/fingerprint.ts), fingerprint regressions and build hash parity.                                                                                                                                                                               |
| OG-AUDIT-006 | Closed locally | Coverage requires valid state, provider, capability, target, release context, acquisition time, and nonexpired evidence. Metadata survives result/report projection. [Core service](../packages/core/src/application/service.ts), service coverage tests.                                                                                                                                                      |
| OG-AUDIT-007 | Closed locally | Exact untruncated release/digest comparisons require complete expected identity sources. Multiple matching telemetry records remain valid. [Workload gates](../packages/gates/src/post/workload.ts), [telemetry identity](../packages/gates/src/post/telemetry-identity.ts).                                                                                                                                   |
| OG-AUDIT-008 | Closed locally | Structural XML parsing handles failure/error, comments and CDATA correctly; malformed, duplicate, and requirement-free synthetic evidence cannot pass. [Synthetic parser](../packages/providers/src/evidence/synthetic.ts), parser/evaluator regressions.                                                                                                                                                      |
| OG-AUDIT-009 | Closed locally | Cancellation checked before and after GitHub publication and report installation; GitHub requests receive the signal. A cancelled run cannot publish successful outputs. [Action](../packages/action/src/main.ts), Action/publication tests.                                                                                                                                                                   |
| OG-AUDIT-010 | Closed locally | Shared policy translation supplies observation, no-data behavior, retries, limits, enforcement, and reporting settings to CLI and Action. [Execution translation](../packages/config/src/execution.ts), parity tests.                                                                                                                                                                                          |
| OG-AUDIT-011 | Closed locally | Preflight gate/query/runtime ceilings; provider query count/length and response ceilings; bounded initialization, sampling, phase scheduling, fail-fast, and cleanup. [Planning](../packages/config/src/planning/create-plan.ts), scheduler/provider boundary tests.                                                                                                                                           |
| OG-AUDIT-012 | Closed locally | Run-level errors appear in JSON, Markdown, JUnit and SARIF even with zero gates. CLI publishes its result only after report publication succeeds. [Reporters](../packages/reporters/src), reporter/publication tests.                                                                                                                                                                                          |
| OG-AUDIT-013 | Closed locally | No synthetic request volumes, duplicated burn windows, assumed SLO identity, or fabricated peer completeness. Explicit queries and typed contracts preserve missing data. Range thresholds retain failing samples. [Telemetry](../packages/providers/src/resolvers/telemetry.ts), [Grafana](../packages/providers/src/resolvers/grafana.ts), [truthfulness tests](../packages/providers/test/session.test.ts). |
| OG-AUDIT-014 | Closed locally | Check/comment/summary enablement, names, sections, annotations, comment markers/events/modes, and bounded lookup are honored. Artifact format/path selection and retention metadata are preserved. [GitHub reporting](../packages/action/src/github-reporter.ts), config and Action tests.                                                                                                                     |
| OG-AUDIT-015 | Closed locally | Mixed evidence-state precedence is deterministic regardless of acquisition order. [Gate execution](../packages/gates/src/execution/execute-gate.ts), permutation regressions.                                                                                                                                                                                                                                  |
| OG-AUDIT-016 | Closed locally | Each expected dependency requires a distinct matching observation. [Trace comparison](../packages/gates/src/post/comparison/trace-metrics.ts), duplicate dependency regressions.                                                                                                                                                                                                                               |
| OG-AUDIT-017 | Closed locally | Cleanup rejection/timeout is a sanitized structured run failure before reporting; late initialization is disposed. [Core service](../packages/core/src/application/service.ts), cleanup/init tests.                                                                                                                                                                                                            |
| OG-AUDIT-018 | Closed locally | Kubernetes SDK cancellation middleware propagates abort signals; adapters bound pages, item counts and repeated continuation tokens. [Kubernetes adapter](../packages/providers/src/runtime/kubernetes/adapter.ts), SDK and pagination tests.                                                                                                                                                                  |
| OG-AUDIT-019 | Closed locally | JWS/JWKS verification is wired into default acquisition, binds algorithm to RSA/P-256 key use, and validates release and deployment completion freshness/order. [Deployment evidence](../packages/providers/src/evidence/deployment.ts), signing-key/time tests.                                                                                                                                               |
| OG-AUDIT-020 | Closed locally | JUnit removes invalid XML 1.0 code points while preserving valid Unicode and escaping content. [JUnit reporter](../packages/reporters/src/junit.ts), control-character/Unicode tests.                                                                                                                                                                                                                          |
| OG-AUDIT-021 | Closed locally | Default CLI/Action service paths tested using raw HTTP and runtime-client fixtures, without replacing provider sessions. Assert decisions, exit/output parity, coverage and all four report files. [Public composition](../tests/end-to-end/public-composition.test.ts), [offline smoke](../tests/end-to-end/offline-quickstart.test.ts).                                                                      |
| OG-AUDIT-022 | Closed locally | Independent clean source trees, separate locked installs/builds, deterministic archive and normalized SBOM comparison. Controlled nondeterminism and unexpected files fail the comparison before publication. [Verifier](../scripts/verify-reproducible-build.ts), [negative tests](../tests/security/reproducibility.test.ts).                                                                                |
| OG-AUDIT-023 | Closed locally | Schema rejects noncanonical outcomes; CLI exits remain pass/warn=0, fail=1, inconclusive=2, error=3. Action conclusions retain their explicit contract. [Policy schema](../packages/config/src/schema/policy.ts), CLI/config tests.                                                                                                                                                                            |
| OG-AUDIT-024 | Closed locally | Text/JSON discovery exposes phases, evidence capabilities, assertion/source contracts, conditions, result semantics, and remediation. Configured-ID explain retains the configured definition. [Discovery](../packages/cli/src/commands/discovery.ts), CLI tests.                                                                                                                                              |
| OG-AUDIT-025 | Closed locally | Credential-free offline README validate/plan/run/catalog/explain path, explicit expected failure, and all report formats tested. [README](../README.md), [offline quickstart tests](../tests/end-to-end/offline-quickstart.test.ts).                                                                                                                                                                           |
| OG-AUDIT-026 | Closed locally | Contributor drift command names the four actual generated files, including troubleshooting.md; contract test regenerates and compares content. [Contributing](../CONTRIBUTING.md), [generated-doc contract](../tests/contract/generated-docs.test.ts).                                                                                                                                                         |

## Operational contracts clarified

- **Runtime facts:** Azure control-plane state does not prove guest service health. VM guest gates
  require expected host IDs and workspace-contained runtime evidence. Container Apps historical
  lifecycle assertions require explicit metrics queries.
- **Authentication:** Kubernetes supports token/client-certificate kubeconfig or in-cluster identity;
  command-based plugins and disabled TLS verification fail safely. Azure uses environment, workload,
  or managed identity credentials. Bundles reject subprocess execution, including transitive SDK paths.
- **Baselines:** Candidate and baseline identities and queries must be explicit and distinct.
  Unsupported implicit discovery is rejected rather than guessed.
- **Signed deployment timestamps:** Completion precedes or coincides with signature issuance within
  allowed skew, is not after expiry/current time, and meets the configured freshness limit.
  “Completed after token issuance” is not required: the deployment completion is the event being signed.
- **Observation:** Selected applicable gates drive sampling; skipped gates and the other phase cannot
  trigger provider reads. Configured observation/sample requirements and phase deadlines remain binding.
- **Retention:** Local files are not a hosted artifact store. Retention is downstream upload metadata;
  the example upload workflow explicitly configures retention. No local expiration daemon is implied.
- **Distribution:** Workspace versions and internal references are aligned to 0.1.0. This prepares
  build metadata; no release, registry publication, commit, or push was performed by this work.

## Validation record

Local commands and results are recorded here so the assessment can be reproduced. Temporary logs
are execution evidence, not permanent product dependencies.

| Check                                                                 | Result                                                                                                                           |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ci`                                                          | Passed: formatting, ESLint, TypeScript, full coverage suite, workspace build. 835 passed / 3 skipped; 89.86% statement coverage. |
| Default route and public composition                                  | All 68 gate acquisition paths; 20 healthy/unhealthy family cases through both public entrypoints. Included in the full suite.    |
| `npm run test:security`                                               | Passed: 25 tests.                                                                                                                |
| `npm run test:performance`                                            | Passed: all 5 tests, including the isolated memory subprocess.                                                                   |
| `npm run test:mutation`                                               | Passed: mutation score 92.21%, above the 85% required threshold.                                                                 |
| `npm audit --omit=dev --json`                                         | Zero production dependency vulnerabilities at the verification checkpoint.                                                       |
| `npm run docs:generate`                                               | Passed; generated references checked against source metadata.                                                                    |
| `npm run bundle && npm run verify:bundle && npm run verify:read-only` | Passed: complete relocatable bundles; 166 production files and both bundles passed the read-only scan.                           |
| Repeated bundle hash comparison                                       | Passed: Action and CLI JavaScript and source maps are byte-identical after another build.                                        |
| `npm run verify:reproducible -- --offline`                            | Passed: two independent locked installs/builds matched all 9 artifacts, including archive and normalized SBOM metadata.          |
| Standalone CLI without repository dependencies                        | Passed: validate, plan, catalog, explain, and expected pass/fail runs from the extracted archive, without node_modules.          |

The full suite skips the opt-in Kind and Azure integrations and the sandbox-restricted memory subprocess.
The dedicated performance run executed that subprocess and passed all five tests. No skipped remote
check is counted as live validation.

## External validation still required

These are deployment/release checks, not missing implementation silently represented as complete:

| Environment check                     | Evidence required before broad rollout                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes/AKS                        | Live get/list permissions, selectors, actual workload shapes, private CA and cancellation behavior against the supported cluster versions.                                            |
| Azure Container Apps and Azure VM     | Real workload/managed identity permissions, subscription/resource IDs, API behavior, guest evidence provenance, and selected lifecycle metrics.                                       |
| Grafana Cloud or self-hosted backends | Real Prometheus/Mimir, Loki, Tempo and Grafana query/label semantics; alert endpoint compatibility; least-privilege scopes; workload cardinality and observation adequacy.            |
| Signed deployment producer            | Real trusted issuer/JWKS distribution, key rotation, release/commit binding and timestamp conventions tested with the deployment pipeline.                                            |
| GitHub release                        | Repository/environment protections, annotated tag/draft release, actual SBOM generation, attestation and immutable artifact publication validated in the authorized release workflow. |

No live cloud credentials or infrastructure mutations were used to obtain the local results.
Read-only operation is preserved throughout the product implementation.
