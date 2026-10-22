# ObserveGate End-to-End Product Audit

> Remediation status: see the [22 October completeness and closure report](product-completeness-review.md).
> This document preserves the original findings and acceptance criteria.

## Audit metadata

- **Audit date:** 2026-10-11 (IST)
- **Audited commit:** `2337d3712cda9d078393869926d7f0b7a8000eaa`
- **Working-tree state before audit:** Clean (`git status --short` produced no output).
- **Scope:** Public CLI and Action contracts; configuration and planning; core decisions; all 68 registered gate types and 86 reference-policy gate instances; provider, runtime, evidence, reporting, test, documentation, bundle, SBOM, and release code; recent history and hidden GitHub automation.
- **Constraints and unavailable validation:** No production systems, credentials, private endpoints, or live cloud accounts were accessed. The opt-in Kind and Azure live suites were not run. Release publication, immutable-release repository settings, attestations, and a clean-machine rebuild could only be inspected statically. `npm audit --omit=dev` required approved network access. No dependencies were installed or changed.
- **Overall confidence:** High. Every backlog item is source-backed; confirmed failure paths were reproduced in memory or through repository commands where safe. Items that remain inference-only are separated under unverified areas.
- **Review assumption:** The documented reference policy, CLI archive, and GitHub Action are intended to be usable product surfaces at this commit, not only scaffolding for future work.

## Executive assessment

**Product-readiness verdict:** **Not release-ready.** ObserveGate has a strong safety-oriented architecture and unusually good unit-level coverage, but the default production composition does not connect most registered gates to the implemented runtime/evidence adapters. Several remaining paths can also misclassify evidence, publish a success after cancellation, or bypass a documented network boundary.

Strongest areas:

- Static read-only enforcement passed across 153 production files and both bundles; no mutation or remote-shell API was found.
- Duplicate YAML keys, aliases, merge keys, top-level unknown fields, policy path escape, and evidence-file symlink escape have direct tests.
- Decision aggregation, assertion unit compatibility, freshness boundaries, configuration ordering, and baseline selection are well isolated and substantially mutation-tested.
- Report publication stages mode-`0600` files, enforces a shared byte ceiling, fsyncs, atomically renames, and exercises rollback failures.
- Network clients distinguish authentication/authorization from retryable failures and bound redirects and streamed response bytes.
- Release automation pins third-party actions, separates read-only build from protected publication, verifies tags/checksums, and creates provenance/SBOM attestations.

Highest-risk gaps:

- The default provider session returns `CAPABILITY_UNSUPPORTED` for runtime and many comparison/readiness gates despite those gates and adapters being documented and registered.
- IPv4-mapped IPv6 private addresses pass the SSRF classifier; DNS validation is not bound to the connection it validates.
- DNS resolution, response reading, and absolute deadlines are not covered consistently by cancellation/timeouts.
- Evidence cache fingerprints can collapse semantically different queries, allowing one gate to reuse another query's result.
- Evidence coverage counts provider presence instead of valid, fresh, capability-matched evidence.
- Release identity and synthetic gates have reproduced false-pass paths.
- A cancelled Action can still publish a successful GitHub check.

Task counts:

| Severity | Count |
| -------- | ----: |
| P0       |     0 |
| P1       |    13 |
| P2       |    11 |
| P3       |     2 |

| Audit dimension                     | Count |
| ----------------------------------- | ----: |
| Product and specification alignment |     2 |
| CLI                                 |     2 |
| GitHub Action                       |     2 |
| Configuration and planning          |     2 |
| Core decision engine                |     3 |
| Gates                               |     2 |
| Providers and runtimes              |     3 |
| Evidence and security               |     3 |
| Reporting                           |     2 |
| Testing and quality engineering     |     1 |
| Performance and reliability         |     2 |
| Developer and operator experience   |     1 |
| Build, packaging, and release       |     1 |

Central promises:

- **Read-only:** Verified within the inspected source, bundles, and automated policy checks. Report-file writes are the documented exception. Live least-privilege behavior was not verified.
- **Deterministic decisions:** Partially verified, but not currently satisfied end to end. Configuration ordering is stable, while query fingerprint collisions and order-dependent mixed-evidence classification can change which evidence or status is used.

## Product contract coverage

Contract map:

| Contract area                  | Audited public contract                                                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users and primary workflows    | Release engineers, SRE/platform teams, and service owners validate or plan a policy without provider access, run pre/post-deployment gates from the CLI or Action, inspect reports, and use `catalog`/`explain` for discovery. Contributors extend typed gates/providers and verify generated artifacts. |
| CLI                            | Node.js 24; `validate`, `plan`, `run`, `explain`, and `catalog`; `--config`, `--phase`, `--target`, `--output-directory`, and `--json` where applicable; user output on stdout, diagnostics on stderr; canonical exits 0/1/2/3 (`README.md:21`, `packages/cli/src/arguments.ts:23`).                     |
| GitHub Action                  | Node 24 Action accepts config, phase, optional target/output directory/token and publishes decision, identity, count, coverage, and report-path outputs; blocking non-pass fails the step (`action.yml:4`, `packages/action/src/main.ts:21`).                                                            |
| Configuration and planning     | One strict YAML policy; bounded environment interpolation, active phase/target selection, reference resolution, deterministic gate ordering, and credential/query-safe plans; validation/plan must not contact providers (`README.md:7`, `README.md:64`).                                                |
| Gates, evidence, and decisions | 86 reference-policy instances across registered gate types; seven evidence states feed blocking/advisory gates and the five final decisions; freshness, identity, comparison, applicability, and coverage must be explicit and deterministic (`README.md:9`, `README.md:19`).                            |
| Providers and runtimes         | Read-only Prometheus/Mimir, Loki, Tempo, Grafana, HTTP/file, Kubernetes/AKS, Azure Container Apps, Azure VM, Linux VM, and Windows VM evidence with bounded HTTPS/file access, cancellation, redaction, and no mutation (`README.md:11`, `README.md:15`).                                                |
| Reports, security, and release | Equivalent JSON, Markdown, JUnit, and SARIF; bounded transactional file publication; workspace containment and read-only enforcement; a self-contained CLI archive, checked-in Action bundle, checksums, CycloneDX SBOM, attestations, and SHA-pinned Action guidance (`README.md:12`, `README.md:71`).  |

| Product promise                                                      | Implementation evidence                                                                                                                                            | Test evidence                                                | Documentation evidence                       | Status             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------- | ------------------ |
| Same core behavior through CLI and Action                            | Both compose `ObservabilityGateService`, but no-data and duration translation differ; `packages/cli/src/main.ts:46`, `packages/action/src/service.ts:27`           | CLI and Action suites pass independently                     | `README.md:13`; spec §44.2                   | Contradicted       |
| Five CLI commands with stable stdout/stderr and exits                | Commands and fixed exits exist, but configured exits and rich discovery output are not honored; `packages/cli/src/arguments.ts:23`, `packages/cli/src/output.ts:8` | CLI contract tests pass                                      | Spec §31                                     | Partially verified |
| Action inputs, outputs, annotations, and blocking failures           | Inputs/outputs exist, but cancellation and publication enablement diverge; `action.yml:4`, `packages/action/src/main.ts:21`, `packages/action/src/outputs.ts:4`    | Action and bundle workflow tests pass                        | Spec §30                                     | Partially verified |
| Strict configuration and gate-specific validation                    | Top-level Zod objects are strict; nested extension records are open                                                                                                | Parser/planner tests cover only selected unknown-field cases | `docs/configuration.md:3`; spec §14.3        | Contradicted       |
| Deterministic evidence acquisition and decisions                     | Ordered aggregation and a run-local store exist, but semantic query collisions and mixed-state ordering remain                                                     | Core aggregation/store/property tests pass                   | `README.md:3`; spec §27.3                    | Partially verified |
| Explicit evidence states and coverage                                | Seven states are modeled, but stale/unavailable evidence can count toward the coverage threshold                                                                   | Freshness and aggregation tests pass                         | Spec §§24, 44.10–12                          | Contradicted       |
| Registered and reachable gate catalogue                              | 68 types and 86 IDs are registered, but the default resolver supports only a subset                                                                                | Registry/reference-policy tests pass                         | `README.md:9`; generated gate catalogue      | Contradicted       |
| Kubernetes, Azure Container Apps, Azure VM, Linux/Windows VM support | Adapter packages and evaluators exist but are not connected in the default CLI/Action composition                                                                  | Adapter unit tests pass; Kind/Azure suites are opt-in        | README and runtime guides                    | Contradicted       |
| Secure, bounded, cancellable providers                               | Guarded transport exists, but mapped-IP and cancellation/deadline reproductions violate the boundary                                                               | Security/provider suites pass                                | `docs/security.md:14`, `docs/security.md:35` | Contradicted       |
| Signed, fresh deployment evidence                                    | JWS/JWKS verification exists, but future `deployedAt` is accepted and default composition does not wire it                                                         | Positive signature tests pass                                | `docs/deployment-evidence.md`                | Partially verified |
| Equivalent JSON, Markdown, JUnit, and SARIF projections              | Explicit renderers exist, but run-level errors with no gates are not equivalent                                                                                    | Golden projection tests pass                                 | Spec §33 and §44.17                          | Contradicted       |
| Transactional bounded report publication                             | Staging, byte budget, fsync, backup, rename, rollback exist                                                                                                        | Reporter failure-injection tests pass                        | `docs/security.md:17`                        | Verified           |
| Read-only/no backend/no mutation                                     | No mutation clients in default composition; policy scanner covers source/bundles                                                                                   | `verify:read-only` and security tests pass                   | README, SECURITY, spec §§7, 36               | Verified           |
| Reproducible, verifiable releases                                    | Deterministic packaging, checksums, SBOM verification, and attestations exist; independent rebuilds are not compared                                               | Bundle/SBOM unit checks pass                                 | README/SECURITY release guidance             | Partially verified |

## Validation results

| Command/check                                                                               | Result                                | Evidence or failure                                                                          | Implication                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `git status --short`                                                                        | Pass                                  | No output before audit                                                                       | Baseline was clean                                                                            |
| `git log -10 --oneline`                                                                     | Pass                                  | Head `2337d37`; recent work focused on reporting, read-only boundaries, and SBOM             | Recent implementation claims were re-verified rather than assumed                             |
| `git ls-files`                                                                              | Pass                                  | 340 tracked files enumerated, including hidden workflows                                     | Audit inventory established                                                                   |
| `npm run format:check`                                                                      | Pass, 3.04 s                          | Prettier reported all matched files formatted                                                | Formatting baseline is clean                                                                  |
| `npm run lint`                                                                              | Pass, 3.16 s                          | ESLint exited 0                                                                              | Static lint baseline is clean                                                                 |
| `npm run typecheck`                                                                         | Pass, 0.20 s                          | `tsc -b` exited 0                                                                            | Workspace types compose                                                                       |
| `npm run test:coverage`                                                                     | Pass, 13.93 s                         | 68 files passed, 2 skipped; 536 tests passed, 3 skipped; 86.97% statements / 74.03% branches | Broad coverage is good, but Action service was 0% and provider session only 31.33% statements |
| `npm run build`                                                                             | Pass, 0.72 s                          | All seven workspaces built                                                                   | Compilation succeeds                                                                          |
| `npm run test:e2e`                                                                          | Pass, 1.58 s                          | 5 files passed, 2 opt-in files skipped; 90 tests passed                                      | Default suite uses mocked gate evidence; Kind/Azure remain unverified                         |
| `npm run test:security`                                                                     | Pass, 2.43 s                          | 7 files / 22 tests passed                                                                    | Existing cases do not exercise allowlisted mapped IPv6 classification                         |
| `npm run test:property`                                                                     | Pass, 1.82 s                          | 4 files / 7 tests passed                                                                     | Covered invariants remain green                                                               |
| `npm run test:mutation`                                                                     | Pass after environment retry, 42.73 s | Initial sandbox run failed `listen EPERM`; approved rerun scored 92.21%, above 85% threshold | Mutation quality verified; surviving mutations remain nonblocking observations                |
| `npm run test:performance`                                                                  | Pass after environment retry, 1.51 s  | Initial run skipped the child-process memory case; approved rerun passed all 5 tests         | Published performance budgets pass in this environment                                        |
| `npm run bundle`                                                                            | Pass, 3.76 s                          | Action and standalone CLI rebuilt; tracked bundle diff remained empty                        | Checked-in Action bundle is current                                                           |
| `npm run verify:bundle`                                                                     | Pass, 0.90 s                          | Action and CLI reported complete and relocatable                                             | Bundle composition checks pass                                                                |
| `npm run verify:read-only`                                                                  | Pass, 3.27 s                          | 153 production files plus both bundles scanned                                               | Static no-mutation promise holds                                                              |
| `npm run docs:generate`                                                                     | Pass, 1.52 s                          | Generated docs left no diff                                                                  | Generated tables are current                                                                  |
| `git diff --exit-code docs/configuration.md docs/gates.md docs/providers.md docs/errors.md` | Fail, exit 128                        | `docs/errors.md` does not exist; generator writes `docs/troubleshooting.md`                  | CONTRIBUTING's documented drift check is broken                                               |
| `npm audit --omit=dev`                                                                      | Pass after network retry, 0.76 s      | Initial restricted lookup failed DNS; approved read-only lookup found 0 vulnerabilities      | No known production advisory in the locked graph at audit time                                |
| README CLI quickstart `validate` command                                                    | Fail, exit 3, 0.18 s                  | `CONFIG_SCHEMA: Missing required environment variable: TARGET_ID`                            | Quickstart is not runnable as written                                                         |
| Default session probe for `runtime.ready`                                                   | Fail as product behavior              | Returned `unsupported` / `CAPABILITY_UNSUPPORTED` without network access                     | Documented runtime gate is unreachable through default composition                            |
| Mapped-IPv6 URL policy probes                                                               | Fail as security behavior             | Allowlisted `::ffff:127.0.0.1` and DNS answer `::ffff:7f00:1` were accepted                  | Private-address SSRF boundary is incomplete                                                   |
| Transport cancellation/deadline probes                                                      | Fail as reliability behavior          | DNS outlived timeout; abort during DNS still fetched; expired deadline succeeded             | Requests are not fully bounded/cancellable                                                    |
| Reporter run-level error probe                                                              | Fail as report behavior               | JUnit emitted 0 tests/0 failures; Markdown omitted global `CONFIG_SCHEMA` diagnostic         | Machine and human projections disagree with canonical error                                   |

## Prioritized gap backlog

### P0 — Critical

No P0 issue was proven. The confirmed network boundary failure is P1 because a practical secret-exposure path depends on the configured HTTPS endpoint and runner network.

### P1 — High

### OG-AUDIT-001: Wire every documented gate to a production evidence resolver

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** L
- **Dimension:** Providers and runtimes
- **Affected surfaces:** CLI/Action/provider/gate/tests/docs
- **Evidence:**
  - `packages/providers/src/session.ts:199` — default CLI/Action session creates telemetry, Grafana, HTTP, and file clients but no Kubernetes, Azure, VM, or deployment-evidence adapters.
  - `packages/providers/src/session.ts:723` — all unmatched gate types return `CAPABILITY_UNSUPPORTED`.
  - `tests/end-to-end/harness.ts:93` — end-to-end scenarios inject a synthetic resolver instead of exercising the default provider session.
  - Focused probe: resolving `runtime.ready` through the default session returned `unsupported` from provider `unresolved`.
- **Gap:** Many registered reference-policy gates and already-implemented adapters are unreachable through the shipped CLI and Action.
- **Impact:** Primary documented Kubernetes, Azure Container Apps, VM, release identity, and comparison workflows end in `error` rather than evaluating evidence.
- **Root cause:** Inference: the catalogue, provider adapters, and default composition were implemented/tested in isolation without a complete resolver ownership map.
- **Required change:** Add an exhaustive gate-to-resolver map that constructs and invokes the existing read-only adapters for the active target, and reject any registered production gate lacking a resolver during validation.
- **Acceptance criteria:**
  - Every gate type used by `examples/observability-gate.yml` resolves through the default CLI and Action composition or is rejected before execution as unsupported.
  - Kubernetes, Container Apps, Azure VM, generic VM, deployment evidence, comparison, and common telemetry gates have happy-path and expected-provider-failure integration tests.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/providers/test packages/gates/test/reference-policy-coverage.test.ts`
  - Regression: `npm run test:e2e && npm run test:security`
- **Dependencies:** OG-AUDIT-004
- **Out of scope:** Adding new gate types, mutation APIs, SSH, WinRM, or live production tests.

### OG-AUDIT-002: Reject mapped private addresses and bind DNS validation to connections

- **Severity:** P1
- **Confidence:** High
- **Effort:** M
- **Dimension:** Evidence and security
- **Affected surfaces:** provider/tests/docs
- **Evidence:**
  - `packages/providers/src/transport/url-policy.ts:62` — mapped IPv4 detection recognizes only dotted suffixes, not canonical hexadecimal IPv6.
  - `packages/providers/src/transport/url-policy.ts:152` — validation returns the original hostname URL rather than a connection bound to validated addresses.
  - `packages/providers/src/transport/guarded-fetch.ts:246` — the independent fetch implementation resolves the hostname again.
  - In-memory probes accepted allowlisted mapped loopback literals and DNS answers.
- **Gap:** Alternate IPv4-mapped encodings bypass forbidden-address checks, and DNS can change between validation and connection.
- **Impact:** A repository-controlled endpoint can reach private or runner-local HTTPS services despite the documented SSRF boundary.
- **Root cause:** Address classification is string-pattern based, and DNS validation is separated from socket establishment.
- **Required change:** Canonicalize all IP forms, reject mapped forbidden ranges, and ensure the address used for the connection is one of the validated answers while preserving TLS hostname verification.
- **Acceptance criteria:**
  - Literal and DNS-returned mapped loopback, RFC1918, link-local, and metadata addresses are rejected even when allowlisted.
  - DNS answer changes between validation and connection cannot redirect the request; public allowlisted IPv4/IPv6 controls still succeed.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run tests/security/ssrf.test.ts packages/providers/test/transport/guarded-fetch.test.ts`
  - Regression: `npm run test:security`
- **Dependencies:** None
- **Out of scope:** General proxy support or weakening HTTPS/allowlist requirements.

### OG-AUDIT-003: Apply cancellation and deadlines across the complete transport lifecycle

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Performance and reliability
- **Affected surfaces:** provider/tests
- **Evidence:**
  - `packages/providers/src/transport/guarded-fetch.ts:220` — DNS validation completes before the child abort controller and timeout are created.
  - `packages/providers/src/transport/guarded-fetch.ts:207` — absolute deadlines are checked only before retry sleep.
  - `packages/providers/src/transport/guarded-fetch.ts:143` — response-reader aborts are wrapped as nonretryable protocol errors.
  - Reproductions showed timeout/abort not stopping DNS, an expired deadline succeeding, and body cancellation returning `PROVIDER_PROTOCOL`.
- **Gap:** Timeouts, cancellation, and deadlines do not cover DNS, fetch, redirects, and body reading as one bounded operation.
- **Impact:** A cancelled or expired gate can continue network work, delay shutdown, and report the wrong failure class.
- **Root cause:** Each transport stage owns partial timing/error logic rather than one deadline-aware signal.
- **Required change:** Derive one effective signal/deadline before URL validation and propagate it through resolution, redirects, fetch, streaming, retry waits, and cleanup.
- **Acceptance criteria:**
  - Abort during DNS, fetch, redirect validation, or body streaming stops promptly and returns `CANCELLED`.
  - Request timeout and absolute deadline cap the first and every retry attempt; malformed payloads remain `PROVIDER_PROTOCOL`.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/providers/test/transport/guarded-fetch.test.ts tests/failure-injection/providers.test.ts`
  - Regression: `npm run test:e2e && npm run test:security`
- **Dependencies:** None
- **Out of scope:** Increasing timeout defaults or retry counts.

### OG-AUDIT-004: Validate complete nested policy and gate schemas

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** L
- **Dimension:** Configuration and planning
- **Affected surfaces:** config/gate/CLI/Action/tests/docs
- **Evidence:**
  - `packages/config/src/schema/policy.ts:177` — runtime definitions use an unrestricted record.
  - `packages/config/src/schema/policy.ts:189` — provider definitions accept arbitrary nested keys.
  - `packages/config/src/schema/policy.ts:219` — reporting/security subtrees contain unrestricted records.
  - `packages/config/src/schema/gate-envelope.ts:20` — assertions are an unrestricted record; core `validate` only prepares the plan at `packages/core/src/application/service.ts:172`.
  - Probes confirmed unknown security, provider, and assertion keys pass parse and plan.
- **Gap:** The advertised strict and gate-type-specific contract stops at outer envelopes.
- **Impact:** Misspelled security controls, thresholds, credentials, and provider options are silently accepted and then ignored or defaulted.
- **Root cause:** Generic `ConfigValue` records were retained where discriminated, strict schemas are required.
- **Required change:** Define strict runtime/provider/reporting/security and per-gate schemas, while explicitly documenting the few maps intended to be extensible.
- **Acceptance criteria:**
  - Unknown nested keys and invalid gate assertions fail `validate` before provider initialization with aggregated safe diagnostics.
  - The reference policy and supported extension maps still validate; happy and expected-failure fixtures cover each discriminated family.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/config/test/parse-policy.test.ts packages/config/test/create-plan.test.ts packages/gates/test/registry.test.ts`
  - Regression: `npm run test:coverage`
- **Dependencies:** None
- **Out of scope:** A general-purpose policy language or dynamic plugins.

### OG-AUDIT-005: Preserve quoted query semantics in evidence fingerprints

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Core decision engine
- **Affected surfaces:** core/provider/tests
- **Evidence:**
  - `packages/core/src/evidence/fingerprint.ts:6` — whitespace and punctuation normalization operates without parsing quoted literals.
  - `packages/core/src/evidence/store.ts:14` — the resulting fingerprint is the cache key for shared in-flight evidence.
  - Probe: `up{job="a b"}` and `up{job="a  b"}` produced the same fingerprint.
- **Gap:** Semantically different PromQL/LogQL literals can share cached evidence.
- **Impact:** A blocking gate can evaluate another gate's result and falsely pass or fail.
- **Root cause:** Text normalization assumes all whitespace around operators and inside strings is insignificant.
- **Required change:** Use a literal-aware canonicalizer or preserve the exact bounded query text in cache identity.
- **Acceptance criteria:**
  - Changes inside quoted/escaped literals always produce distinct fingerprints and loader calls.
  - Proven insignificant whitespace outside literals may deduplicate, with property tests for stability and separation.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/core/test/evidence/store.test.ts tests/property/decisions.test.ts`
  - Regression: `npm run test:property && npm run test:coverage`
- **Dependencies:** None
- **Out of scope:** Query optimization or provider-side caching.

### OG-AUDIT-006: Count only valid capability-matched evidence toward coverage

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Core decision engine
- **Affected surfaces:** core/gate/provider/reporter/tests
- **Evidence:**
  - `packages/core/src/application/service.ts:155` — coverage is satisfied when any evidence reference has the provider name.
  - `packages/core/src/domain/gates.ts:21` — evidence references omit state and capability.
  - `packages/gates/src/execution/execute-gate.ts:23` — projection discards those fields.
  - Reproduced stale blocking evidence reporting 100% coverage.
- **Gap:** Stale, invalid, insufficient, unavailable, or wrong-capability evidence can satisfy coverage.
- **Impact:** A phase can avoid the configured coverage failure despite lacking trustworthy required evidence.
- **Root cause:** Coverage is reconstructed from lossy report references rather than acquisition requirements and evidence states.
- **Required change:** Carry requirement identity, capability, and final evidence state into coverage calculation.
- **Acceptance criteria:**
  - Only valid, fresh evidence satisfying the exact requirement counts as covered; skipped gates remain excluded.
  - Multiple capabilities from one provider are counted independently and reported deterministically.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/core/test/application/service.test.ts packages/core/test/decisions/aggregate.test.ts`
  - Regression: `npm run test:property && npm run test:coverage`
- **Dependencies:** None
- **Out of scope:** Changing configured coverage thresholds.

### OG-AUDIT-007: Require exact and complete release identity evidence

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Gates
- **Affected surfaces:** gate/provider/core/tests
- **Evidence:**
  - `packages/gates/src/post/workload.ts:3` — identities are truncated and sanitized before comparison.
  - `packages/gates/src/post/workload.ts:15` — missing sources are dropped and only two matching values are required.
  - `packages/gates/src/post/telemetry-identity.ts:12` — missing expected/observed values become the same sentinel.
  - Probes passed with missing runtime identity and with distinct IDs collapsed by sanitization.
- **Gap:** Identity gates can pass without proving the runtime candidate and can compare lossy display strings.
- **Impact:** A wrong release can be approved.
- **Root cause:** Redaction/display normalization is reused as the comparison representation, and source completeness is implicit.
- **Required change:** Compare validated canonical values exactly and require every policy-mandated identity source; sanitize only report rendering.
- **Acceptance criteria:**
  - Missing runtime, attestation, expected, or telemetry identity fails/inconclusive according to policy and never passes.
  - Distinct long or punctuation-bearing identifiers remain distinct; exact matching identifiers pass across CLI and Action.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/gates/test/post/common/common.test.ts`
  - Regression: `npm run test:e2e && npm run test:property`
- **Dependencies:** OG-AUDIT-004
- **Out of scope:** Inventing release IDs or baseline discovery heuristics.

### OG-AUDIT-008: Reject errored, commented, and requirement-free synthetic evidence

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Evidence and security
- **Affected surfaces:** provider/gate/tests
- **Evidence:**
  - `packages/providers/src/evidence/synthetic.ts:39` — JUnit is parsed with a testcase regex that also sees comments.
  - `packages/providers/src/evidence/synthetic.ts:46` — `<error>` defaults to `passed`.
  - `packages/providers/src/evidence/synthetic.ts:89` — JSON accepts negative duration.
  - `packages/gates/src/post/synthetic.ts:9` — an empty required-test list returns zero assertions, which passes.
- **Gap:** Invalid or requirement-free synthetic evidence can become a passing blocking gate.
- **Impact:** A failing critical journey can be reported healthy and allow deployment.
- **Root cause:** Partial XML recognition and vacuous assertion success are treated as validation.
- **Required change:** Use a bounded XML parser/strict JSON schema and require a nonempty configured test set before evaluation.
- **Acceptance criteria:**
  - JUnit `<error>`, malformed XML, commented testcases, negative durations, duplicate names, and missing required tests cannot pass.
  - Equivalent valid JSON and JUnit fixtures produce the same named outcomes and release correlation.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/providers/test/evidence/contracts.test.ts packages/gates/test/post/reliability/reliability.test.ts`
  - Regression: `npm run test:e2e && npm run test:security`
- **Dependencies:** OG-AUDIT-004
- **Out of scope:** Running synthetic tests or adding a synthetic SaaS integration.

### OG-AUDIT-009: Stop Action publication immediately after cancellation

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** GitHub Action
- **Affected surfaces:** Action/reporter/tests
- **Evidence:**
  - `packages/action/src/main.ts:52` — outputs are set before summary/check/comment publication.
  - `packages/action/src/main.ts:53` — no abort check follows summary writing.
  - `packages/action/src/github-reporter.ts:43` — check creation accepts no cancellation signal.
  - Reproduction aborted during summary and still published a `success` check with no Action failure.
- **Gap:** Action cancellation does not dominate GitHub publication or final status.
- **Impact:** A cancelled deployment gate can leave an authoritative-looking success check.
- **Root cause:** Cancellation is propagated to core/local reports but not to the GitHub reporting phase.
- **Required change:** Treat Action publication as part of the cancellable execution transaction and prevent success outputs/checks after abort.
- **Acceptance criteria:**
  - Cancellation before/during summary, check, or comment stops subsequent publication and fails the Action as cancelled.
  - A cancelled run never emits `decision=pass` as its final output or a successful/neutral check; normal pass/warn behavior remains unchanged.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/action/test/action.test.ts packages/action/test/github-reporter.test.ts`
  - Regression: `npm run test:e2e && npm run bundle && npm run verify:bundle`
- **Dependencies:** None
- **Out of scope:** Cancelling external deployment jobs.

### OG-AUDIT-010: Share CLI and Action execution-policy translation

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Product and specification alignment
- **Affected surfaces:** CLI/Action/core/config/tests
- **Evidence:**
  - `packages/cli/src/main.ts:91` — CLI honors configured blocking no-data behavior.
  - `packages/action/src/service.ts:73` — Action hardcodes blocking no-data to `fail`.
  - `packages/cli/src/main.ts:38` and `packages/action/src/service.ts:19` — duplicated duration parsers omit documented `d` units and silently return zero.
  - `packages/config/src/planning/create-plan.ts:20` — the planner accepts day units.
- **Gap:** Identical policies are translated differently by the two public entry points, and valid durations can become zero.
- **Impact:** CLI and Action can report different gate statuses, exits, waits, and sampling windows.
- **Root cause:** Execution-policy mapping is duplicated outside the shared core/config contract.
- **Required change:** Move validated policy-to-execution translation into one shared adapter used by both entry points.
- **Acceptance criteria:**
  - CLI and Action produce identical execution settings and decisions for all no-data modes and duration units.
  - Invalid durations fail validation; `1d` maps to 86,400,000 ms rather than zero; parity tests cover happy and failure paths.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts packages/action/test/action.test.ts packages/config/test/create-plan.test.ts`
  - Regression: `npm run test:e2e && npm run test:property`
- **Dependencies:** None
- **Out of scope:** Adding new duration syntax.

### OG-AUDIT-011: Enforce every accepted execution and resource limit before work starts

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Configuration and planning
- **Affected surfaces:** config/core/provider/CLI/Action/tests/docs
- **Evidence:**
  - `packages/config/src/schema/policy.ts:242` — `maximum_gates`, `maximum_queries`, query length, and total runtime are accepted.
  - `packages/config/src/planning/create-plan.ts:167` — plan creation uses only phase timeout, gate list, and per-provider concurrency.
  - `packages/providers/src/session.ts:271` — maximum query length is hardcoded to 16 KiB.
  - Probe: `maximum_gates=1` and `maximum_total_runtime=1ms` still yielded 39 gates and a 720,000 ms deadline; `gate_defaults.enabled=false` was ignored.
- **Gap:** Public safety controls are accepted and documented without effective enforcement.
- **Impact:** A policy can exceed operator-approved work, query, and runtime budgets, or run gates globally disabled by policy.
- **Root cause:** Schema metadata and planning/provider consumers are not connected by one effective-limits object.
- **Required change:** Resolve all limits/defaults during planning, reject impossible combinations, and pass immutable effective limits to schedulers/providers.
- **Acceptance criteria:**
  - Gate/query counts and total runtime fail closed before provider initialization; phase/gate/provider deadlines never exceed the total ceiling.
  - `gate_defaults.enabled`, query length, parallelism, response size, and report size are either enforced or rejected as unsupported.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/config/test/create-plan.test.ts packages/core/test/execution/scheduler.test.ts packages/providers/test/metrics/prometheus-client.test.ts`
  - Regression: `npm run test:performance && npm run test:coverage`
- **Dependencies:** OG-AUDIT-004
- **Out of scope:** Raising documented defaults or auto-tuning limits.

### OG-AUDIT-012: Represent run-level failures consistently in every report

- **Severity:** P1
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Reporting
- **Affected surfaces:** reporter/CLI/Action/tests
- **Evidence:**
  - `packages/core/src/application/service.ts:121` — configuration/execution errors can return `decision=error` with zero gates and a global diagnostic.
  - `packages/reporters/src/junit.ts:33` — JUnit failure count derives only from gates.
  - `packages/reporters/src/markdown.ts:78` — Markdown renders gate diagnostics but not result-level diagnostics.
  - Reproduction emitted zero JUnit failures and omitted the Markdown diagnostic for a canonical error result.
- **Gap:** Non-JSON projections can look successful or omit the reason when execution fails before gates exist.
- **Impact:** CI consumers and operators can receive a passing JUnit report for a failed gate run.
- **Root cause:** Inference: projection models assume every failure belongs to a gate.
- **Required change:** Add an explicit run-level failure representation to Markdown/JUnit and keep JSON, Action summary, and outputs semantically aligned.
- **Acceptance criteria:**
  - `error`, `fail`, or `inconclusive` with no gate failures produces a failing JUnit testcase and visible sanitized Markdown diagnostic.
  - Pass/warn projections remain nonblocking and all formats retain stable identifiers/order.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/reporters/test/reporters.test.ts packages/action/test/github-reporter.test.ts`
  - Regression: `npm run test:coverage && npm run test:e2e`
- **Dependencies:** None
- **Out of scope:** Embedding raw provider payloads or stack traces.

### OG-AUDIT-013: Replace fabricated provider fields with gate-specific normalized evidence

- **Severity:** P1
- **Confidence:** High
- **Effort:** L
- **Dimension:** Providers and runtimes
- **Affected surfaces:** provider/gate/core/tests
- **Evidence:**
  - `packages/providers/src/session.ts:375` — metric gates use only the first returned sample without deterministic identity selection or aggregation.
  - `packages/providers/src/session.ts:450` — trace cache identity omits the effective query selectors and minimum trace requirement.
  - `packages/providers/src/session.ts:495` — unknown peer percentage is synthesized as zero.
  - `packages/providers/src/session.ts:580` — SLO identity match is true whenever an SLO exists; `packages/providers/src/session.ts:602` copies one burn value into both windows.
- **Gap:** Several public gates consume placeholders or ambiguous first-record values instead of the provider facts they claim to evaluate.
- **Impact:** Metrics, service-graph, SLO-label, and paired burn-rate gates can falsely pass or reuse unrelated evidence.
- **Root cause:** A generic provider-session switch performs lossy gate-specific normalization without typed resolver contracts.
- **Required change:** Give each resolver a typed normalized contract and derive every asserted field from validated provider data; return insufficient/unsupported when data is unavailable.
- **Acceptance criteria:**
  - Metric selection requires canonical target/release identity and deterministic multi-series handling.
  - Trace cache keys include effective selectors and sampling requirements; unknown-peer, SLO-label, and short/long burn values are evidence-derived or inconclusive.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/providers/test packages/gates/test/post/reliability/reliability.test.ts`
  - Regression: `npm run test:e2e && npm run test:property`
- **Dependencies:** OG-AUDIT-004, OG-AUDIT-005
- **Out of scope:** New provider products or statistical-significance analysis.

### P2 — Medium

### OG-AUDIT-014: Honor configured GitHub publication switches

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** GitHub Action
- **Affected surfaces:** Action/config/reporter/tests/docs
- **Evidence:**
  - `packages/action/src/main.ts:53` — step summary is unconditional.
  - `packages/action/src/main.ts:54` — token presence unconditionally enables both check and PR comment publication.
  - `action.yml:19` — token is documented for explicitly enabled reporting.
- **Gap:** Policy switches for summaries, checks, comments, and annotations are not consumed.
- **Impact:** Operational metadata can be published unexpectedly and users may grant unnecessary write permissions.
- **Root cause:** Inference: reporting configuration is not part of the Action's prepared execution/publication contract.
- **Required change:** Carry normalized reporting enablement to the Action and gate each publication independently.
- **Acceptance criteria:**
  - A token alone enables nothing; disabled channels perform zero API/file writes.
  - Each enabled channel has pass/failure/permission-denied tests and uses only its documented permission.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/action/test/action.test.ts packages/action/test/github-reporter.test.ts`
  - Regression: `npm run bundle && npm run verify:bundle`
- **Dependencies:** OG-AUDIT-010
- **Out of scope:** Adding new GitHub publication channels.

### OG-AUDIT-015: Make mixed evidence-state precedence independent of acquisition order

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** S
- **Dimension:** Core decision engine
- **Affected surfaces:** core/gate/tests
- **Evidence:**
  - `packages/gates/src/execution/execute-gate.ts:155` — only the first non-valid evidence envelope controls classification.
  - Probe: `[missing, unavailable]` became inconclusive while the reverse order became error.
- **Gap:** Identical evidence states can produce different gate outcomes based on array order.
- **Impact:** Concurrency/provider ordering changes decision classification and can hide provider errors.
- **Root cause:** Classification uses `find` instead of deterministic state reduction and diagnostic preservation.
- **Required change:** Define and implement an explicit precedence across all evidence states.
- **Acceptance criteria:**
  - All permutations of the same evidence-state multiset yield the same status and diagnostics.
  - Provider/security errors are never downgraded by a preceding missing/stale item; advisory mapping remains explicit.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/gates/test/execute-gate.test.ts`
  - Regression: `npm run test:property && npm run test:coverage`
- **Dependencies:** None
- **Out of scope:** Changing policy-configured no-data behavior.

### OG-AUDIT-016: Require one distinct evidence record for every expected dependency

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** S
- **Dimension:** Gates
- **Affected surfaces:** gate/provider/tests
- **Evidence:**
  - `packages/gates/src/post/comparison/trace-metrics.ts:16` — completeness compares selected row count with expected set size.
  - Probe: two records for dependency A satisfied expected dependencies A and B.
- **Gap:** Duplicate evidence can mask a missing expected dependency.
- **Impact:** A dependency regression gate can pass without observing one required downstream service.
- **Root cause:** Cardinality equality is used instead of key-set equality.
- **Required change:** Index evidence by dependency identity, reject/resolve duplicates deterministically, and compare exact expected keys.
- **Acceptance criteria:**
  - Duplicate A plus missing B is inconclusive/fail per policy; one valid record per A/B passes.
  - Unknown and duplicate dependencies have deterministic diagnostics and ordering.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/gates/test/post/reliability/reliability.test.ts`
  - Regression: `npm run test:coverage`
- **Dependencies:** None
- **Out of scope:** Automatic dependency discovery.

### OG-AUDIT-017: Contain provider cleanup failures within structured execution results

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Performance and reliability
- **Affected surfaces:** core/provider/CLI/Action/tests
- **Evidence:**
  - `packages/core/src/application/service.ts:281` — `ProviderSession.close()` is awaited in `finally` outside result-producing error handling.
  - Probe: a throwing close rejected `service.run()` instead of returning `ExecutionResult`; no cleanup deadline exists.
- **Gap:** Cleanup can erase a completed decision or hang shutdown.
- **Impact:** CLI/Action bypass normal redaction, reporting, and exit semantics during provider cleanup failures.
- **Root cause:** Session lifecycle errors are not modeled as execution diagnostics.
- **Required change:** Bound cleanup and convert close failures to safe result-level diagnostics without changing an existing fail into pass.
- **Acceptance criteria:**
  - Throwing, rejecting, hanging, and cancellation-aware close paths always return a structured non-pass result within a bound.
  - Successful cleanup does not alter completed decisions or gate evidence.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/core/test/application/service.test.ts`
  - Regression: `npm run test:e2e`
- **Dependencies:** OG-AUDIT-003
- **Out of scope:** Persisting provider sessions across runs.

### OG-AUDIT-018: Propagate cancellation into Kubernetes API calls and pagination

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** Providers and runtimes
- **Affected surfaces:** provider/tests
- **Evidence:**
  - `packages/providers/src/runtime/kubernetes/client.ts:25` — read interface methods accept no `AbortSignal`.
  - `packages/providers/src/runtime/kubernetes/client.ts:48` — SDK calls receive no cancellation argument.
  - `packages/providers/src/runtime/kubernetes/adapter.ts:164` — cancellation is checked before, not after, each awaited page.
  - Reproductions left an in-flight workload read pending and returned valid evidence after final-page cancellation.
- **Gap:** Kubernetes evidence collection is not promptly cancellable and can approve evidence after abort.
- **Impact:** Workflow cancellation can hang or produce a stale success.
- **Root cause:** Cancellation is implemented between calls instead of through the client contract.
- **Required change:** Pass abort signals into SDK calls and validate cancellation after every response and before snapshot publication.
- **Acceptance criteria:**
  - Aborting workload and page requests settles promptly as `CANCELLED`; no valid snapshot is returned after abort.
  - Pagination has bounded item/page/token-cycle limits and cancellation tests for first, middle, and final calls.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/providers/test/runtime/kubernetes/adapter.test.ts`
  - Regression: `npm run test:e2e && npm run test:security`
- **Dependencies:** OG-AUDIT-001
- **Out of scope:** Kubernetes watches or mutation verbs.

### OG-AUDIT-019: Validate deployment completion freshness and signing-key algorithm binding

- **Severity:** P2
- **Confidence:** High
- **Effort:** M
- **Dimension:** Evidence and security
- **Affected surfaces:** provider/tests/docs
- **Evidence:**
  - `packages/providers/src/evidence/deployment.ts:182` — only token `iat` and `exp` are time-bounded.
  - `packages/providers/src/evidence/deployment.ts:193` — `deployedAt` is checked only for parseability.
  - `packages/providers/src/evidence/deployment.ts:137` — resolved JWK type/curve is not explicitly bound to `alg`.
  - A signed token with `deployedAt` one year in the future was accepted; an ES256-labelled P-384 signature was also accepted.
- **Gap:** Signed evidence can be cryptographically valid yet temporally or algorithmically outside the documented contract.
- **Impact:** Future-dated deployment evidence can appear fresh; key-policy mistakes are not rejected early.
- **Root cause:** Claim validation and JOSE algorithm/key validation are incomplete after signature verification.
- **Required change:** Enforce deployed-at skew/freshness/order and explicit algorithm-to-key-type/curve constraints.
- **Acceptance criteria:**
  - Future, stale, post-expiry, and pre-issued deployment times fail with safe blocking diagnostics.
  - RS256 requires an allowed RSA key; ES256 requires P-256; valid rotation and unknown-key failures remain covered.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/providers/test/evidence/deployment.test.ts`
  - Regression: `npm run test:security`
- **Dependencies:** OG-AUDIT-001
- **Out of scope:** Designing a signing-key management service.

### OG-AUDIT-020: Emit XML 1.0-safe JUnit for arbitrary sanitized diagnostics

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** S
- **Dimension:** Reporting
- **Affected surfaces:** reporter/tests
- **Evidence:**
  - `packages/reporters/src/junit.ts:4` — escaping handles XML metacharacters but retains forbidden control characters.
  - Probe placed U+0001 unchanged into emitted JUnit.
- **Gap:** Valid product diagnostics can produce an invalid XML document.
- **Impact:** CI test-report consumers can reject the entire artifact.
- **Root cause:** XML character validity is not enforced before escaping.
- **Required change:** Remove or replace XML 1.0-forbidden code points while preserving valid Unicode and meaning.
- **Acceptance criteria:**
  - Control characters, malformed surrogate input, astral Unicode, and metacharacters always yield parseable JUnit.
  - JSON/Markdown retain safe readable equivalents and no unsanitized diagnostic is introduced.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/reporters/test/reporters.test.ts`
  - Regression: `npm run test:coverage`
- **Dependencies:** None
- **Out of scope:** Supporting XML versions other than 1.0.

### OG-AUDIT-021: Exercise the shipped CLI and Action composition end to end

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** L
- **Dimension:** Testing and quality engineering
- **Affected surfaces:** tests/CLI/Action/provider/gate/reporter
- **Evidence:**
  - `tests/end-to-end/harness.ts:93` — most product scenarios inject a resolver returning test-owned normalized evidence.
  - `tests/end-to-end/pre-deployment.test.ts:36` — the only public CLI composition scenario exercises `identity.contract`, a local shortcut.
  - Coverage reported `packages/action/src/service.ts` at 0% and `packages/providers/src/session.ts` at 31.33% statements.
- **Gap:** Passing end-to-end tests do not traverse the default resolver, runtime adapters, Action composition, or real report semantics for representative gates.
- **Impact:** Major integration breaks such as unsupported runtime gates and CLI/Action parity escaped the suite.
- **Root cause:** Inference: tests optimize for evaluator breadth using mocked evidence rather than layering a smaller real-composition suite.
- **Required change:** Add deterministic fake-server/file/runtime scenarios through the shipped CLI and Action services, retaining evaluator unit tests separately.
- **Acceptance criteria:**
  - At least one happy and expected-failure path per provider/runtime family uses the default composition and asserts decision, exit/Action failure, outputs, diagnostics, and all report files.
  - Cancellation, malformed response, authorization, stale evidence, and unsupported capability are covered without production dependencies.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run tests/end-to-end tests/failure-injection packages/action/test/action.test.ts`
  - Regression: `npm run test:coverage && npm run test:e2e && npm run test:security`
- **Dependencies:** OG-AUDIT-001, OG-AUDIT-009, OG-AUDIT-010, OG-AUDIT-012, OG-AUDIT-013
- **Out of scope:** Mandatory live Azure or production-provider tests on pull requests.

### OG-AUDIT-022: Verify release reproducibility across independent clean builds

- **Severity:** P2
- **Confidence:** High
- **Effort:** M
- **Dimension:** Build, packaging, and release
- **Affected surfaces:** release/tests
- **Evidence:**
  - `.github/workflows/release.yml:92` — both archives are created sequentially from the same already-built `dist/cli` directory.
  - `.github/workflows/release.yml:94` — `cmp` proves deterministic tar packaging, not deterministic compilation/bundling.
- **Gap:** The release check does not prove that two clean builds from the same source produce the same shipped bytes.
- **Impact:** Build-time nondeterminism or dependency/toolchain contamination can enter an attested immutable release undetected.
- **Root cause:** Reproducibility verification repeats packaging rather than rebuilding in an independent directory/environment.
- **Required change:** Build the CLI twice from clean, isolated source/dependency states with the same pinned toolchain and compare final archives/checksums.
- **Acceptance criteria:**
  - Independent builds produce byte-identical CLI archives and deterministic finalized SBOM metadata.
  - A controlled nondeterministic input causes the check to fail before attestation/publication.
- **Validation:**
  - Focused: repository-supported local release-reproducibility script added by the task
  - Regression: `npm run bundle && npm run verify:bundle && npm run verify:read-only`
- **Dependencies:** None
- **Out of scope:** Publishing a release or contacting production package registries.

### OG-AUDIT-023: Honor or reject configured CLI decision exit codes

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** S
- **Dimension:** CLI
- **Affected surfaces:** CLI/config/tests/docs
- **Evidence:**
  - `packages/config/src/schema/policy.ts:148` — arbitrary exit codes 0–255 are accepted for every decision.
  - `packages/cli/src/output.ts:8` — CLI hardcodes 0/1/2/3.
  - Probe: `fail.exit_code=42` parsed successfully but CLI mapping remained 1.
- **Gap:** A public configuration field is accepted but ignored.
- **Impact:** Workflow control flow can differ from the operator's validated policy.
- **Root cause:** Decision outcomes are parsed as configuration but not carried to the CLI result adapter.
- **Required change:** Either honor configured CLI mappings consistently or constrain schema/docs to the fixed public contract.
- **Acceptance criteria:**
  - Supported mappings produce the validated exit code for all five decisions, or noncanonical values fail validation.
  - Action conclusions and CLI exits remain explicitly distinct and parity-tested at the decision level.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts packages/config/test/parse-policy.test.ts`
  - Regression: `npm run test:e2e`
- **Dependencies:** OG-AUDIT-010
- **Out of scope:** Mapping successful decisions to failing GitHub conclusions.

### OG-AUDIT-024: Complete the documented explain and catalog output contracts

- **Severity:** P2
- **Confidence:** Confirmed
- **Effort:** M
- **Dimension:** CLI
- **Affected surfaces:** CLI/gate/docs/tests
- **Evidence:**
  - `packages/cli/src/commands/explain.ts:9` — direct explain prints only identifier, description, and phases.
  - `packages/cli/src/commands/catalog.ts:7` — text catalogue prints only type and description.
  - `docs/observegate-spec.md:1169` — explain promises required evidence, assertions, result semantics, and remediation; catalogue promises conditions, capabilities, and assertion families.
- **Gap:** Discovery commands omit most of the information users need to configure a gate safely.
- **Impact:** Users must read source/reference YAML and can configure incompatible evidence or assertions.
- **Root cause:** Registry metadata is generic and the CLI projection is minimal.
- **Required change:** Extend source-owned metadata and render the promised fields consistently in text and JSON.
- **Acceptance criteria:**
  - Explain exposes evidence requirements, assertion schema/semantics, phases, enforcement outcomes, and remediation support for both type and configured gate ID.
  - Catalogue exposes runtime conditions, provider capabilities, assertion families, and stable machine-readable fields.
- **Validation:**
  - Focused: `node node_modules/vitest/vitest.mjs run packages/cli/test/cli.test.ts packages/gates/test/registry.test.ts`
  - Regression: `npm run docs:generate && npm run test:coverage`
- **Dependencies:** OG-AUDIT-004
- **Out of scope:** Interactive configuration generation.

### P3 — Low

### OG-AUDIT-025: Make the README CLI quickstart runnable without hidden prerequisites

- **Severity:** P3
- **Confidence:** Confirmed
- **Effort:** S
- **Dimension:** Developer and operator experience
- **Affected surfaces:** docs/CLI
- **Evidence:**
  - `README.md:56` — quickstart invokes the exhaustive environment-dependent example directly.
  - Reproduction failed with `Missing required environment variable: TARGET_ID` before validation.
  - `examples/observability-gate.yml:84` — the example requires target and many phase-specific environment variables.
- **Gap:** The first documented CLI commands do not run as written.
- **Impact:** New users cannot reach validation/planning without reverse-engineering the exhaustive example's environment contract.
- **Root cause:** The complete reference policy is used as a minimal quickstart.
- **Required change:** Point quickstart commands at a runnable safe sample or list/provide all required nonsecret variables and expected outputs.
- **Acceptance criteria:**
  - A clean checkout following the README runs `validate`, `plan`, `catalog`, and `explain` exactly as written without provider access.
  - The run example clearly distinguishes required credentials/evidence and includes an expected-failure path.
- **Validation:**
  - Focused: execute every README CLI code block in a documentation smoke test
  - Regression: `npm run test:e2e`
- **Dependencies:** OG-AUDIT-001, OG-AUDIT-004
- **Out of scope:** Bundling demo credentials or contacting live providers.

### OG-AUDIT-026: Correct the documented documentation-drift command

- **Severity:** P3
- **Confidence:** Confirmed
- **Effort:** S
- **Dimension:** Product and specification alignment
- **Affected surfaces:** docs/tests
- **Evidence:**
  - `CONTRIBUTING.md:71` — drift check names `docs/errors.md`.
  - `scripts/generate-docs.ts:183` — generator owns `docs/troubleshooting.md`, not `docs/errors.md`.
  - Exact documented command exits 128 because `docs/errors.md` is absent.
- **Gap:** Contributor instructions contain a validation command that always fails.
- **Impact:** Contributors cannot distinguish real generated-document drift from a broken path.
- **Root cause:** Inference: the generated error reference was renamed to troubleshooting without updating the command.
- **Required change:** Update the command to the generator-owned files and keep it under automated documentation smoke coverage.
- **Acceptance criteria:**
  - The documented command exits 0 on a clean tree and nonzero after intentional generated-doc drift.
  - Generator source, contract test, and contributor instructions reference the same file set.
- **Validation:**
  - Focused: `npm run docs:generate && git diff --exit-code -- docs/configuration.md docs/gates.md docs/providers.md docs/troubleshooting.md`
  - Regression: `node node_modules/vitest/vitest.mjs run tests/contract/generated-docs.test.ts`
- **Dependencies:** None
- **Out of scope:** Adding a second error-code document.

## Cross-cutting findings

- **Registration is mistaken for reachability.** Catalogue/reference-policy tests prove names resolve to evaluators, but not that shipped provider composition can acquire their evidence.
- **Accepted configuration lacks ownership.** Several fields are documented, parsed, and generated into reference docs without one component responsible for enforcing them.
- **Public-entrypoint duplication causes drift.** CLI and Action separately translate the same policy into execution settings and reporting behavior.
- **Normalization sometimes invents certainty.** First-record selection, constant zeros/booleans, lossy identity sanitization, and vacuous assertion sets convert unknown data into pass-capable values.
- **Tests are broad but layered too low.** Unit, property, mutation, and failure-injection coverage are strong; realistic default-composition paths are sparse.
- **Run-level failure is not a first-class report entity.** Canonical JSON retains it, while JUnit/Markdown primarily model gate-level failures.

## Coverage gaps and unverified areas

- **Kind integration:** Not run because it provisions a disposable cluster and images. Safest next step: run the pinned `kind` job in CI and retain logs/artifacts.
- **Azure compatibility:** Not run because no live account/identity was authorized. Safest next step: run the protected `azure-read-only-e2e` workflow with Reader scope.
- **GitHub release settings and publication:** Immutable-release setting, draft release, settings token, attestations, and remote tag identity were not accessed. Safest next step: exercise a nonproduction release repository/environment.
- **Clean-machine reproducibility:** Current workflow compares two archives from one build directory. Safest next step: isolated double-build verification from the same commit and lockfile.
- **DNS-to-socket binding:** Rebinding risk is source-confirmed but not exercised against a real resolver/socket. Safest next step: a local controlled DNS/HTTPS integration fixture.
- **Concurrent report writers and crash durability:** Transactional failure injection covers rename/restore failures, not competing processes or power loss. Safest next step: bounded multi-process and crash-recovery tests.
- **Long-running provider initialization:** Phase timeout starts after initialization; current default initialization is synchronous, but future/runtime wiring can change that. Safest next step: add a deliberately uncooperative initialization fixture when OG-AUDIT-001 lands.
- **Pre-existing skipped tests:** Coverage/e2e skipped Kind and Azure; the first sandboxed performance run skipped child-process memory validation, which passed after approved rerun.

## Recommended execution order

1. **Decision integrity and security boundaries:** OG-AUDIT-002, OG-AUDIT-003, OG-AUDIT-004, OG-AUDIT-005, OG-AUDIT-006, OG-AUDIT-007, OG-AUDIT-008, OG-AUDIT-009, OG-AUDIT-012.
2. **Primary workflow correctness:** OG-AUDIT-010, OG-AUDIT-011, OG-AUDIT-001, OG-AUDIT-013, OG-AUDIT-014, OG-AUDIT-019.
3. **Reporting and operational behavior:** OG-AUDIT-015, OG-AUDIT-016, OG-AUDIT-017, OG-AUDIT-018, OG-AUDIT-020, OG-AUDIT-023.
4. **Test and documentation closure:** OG-AUDIT-021, OG-AUDIT-024, OG-AUDIT-025, OG-AUDIT-026.
5. **Maintainability and release assurance:** OG-AUDIT-022.

## Deferred observations

- Mutation testing left 45 surviving and 2 uncovered mutants while still exceeding the 85% break threshold. Deferred because no additional user-visible defect was established beyond tasks already listed.
- Action annotations are capped at 50. Deferred because the GitHub API limit is respected and no silent loss claim was reproduced; larger-result summarization can be evaluated after primary correctness work.
- Report output directories are not confined to the workspace. Deferred because the path is an explicit user input and the current documentation does not unambiguously require containment for report destinations.
- Advisory provider errors retain gate status `error` while aggregation returns `warn`. Deferred as a result-shape mismatch until machine-consumer expectations are clarified; it does not currently block deployment.
- The implementation plan retains unchecked boxes. Deferred because it is explicitly a plan, and unchecked status alone is not evidence of missing implementation.
- The release version remains `0.0.0`. Deferred because no published-version claim or release attempt was provided; the workflow correctly requires tag/package alignment.
- `npm audit --omit=dev` found no known production vulnerabilities. This is time-bound evidence, not proof that bundled dependencies are vulnerability-free.
