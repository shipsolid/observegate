# ObserveGate product completeness review

**Reviewed:** 22 October 2026 (IST)  
**Source:** `50506d325ab52cea701876c6b6e68e881ff982f0`  
**Scope:** The ObserveGate repository: CLI, GitHub Action, configuration, evidence acquisition,
decision engine, advertised gates/runtimes, reports, onboarding, tests, and release automation.

## Assessment

**ObserveGate is a substantial implementation, but it is not complete enough to serve as the
production deployment gate advertised in its README.** Its main constraint is integration and
decision integrity: many evaluators and adapters exist independently, but the public entrypoints
cannot compose them into the promised workflows.

| Adoption decision                         | Assessment                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Engineering demonstration                 | Suitable with explicitly selected, verified scenarios.                                                                                     |
| Supervised pilot                          | Conditional: first repair the bundle and validate the exact policy through both public entrypoints; review every evidence mapping it uses. |
| General production deployment enforcement | Hold until the release-blocking findings below are closed.                                                                                 |

This assessment uses the repository's declared product contract, rather than assuming additional
enterprise or SaaS requirements. It does not assign an overall completion percentage: counting
implemented classes, registered gates, or passing tests would overstate usable product coverage.

The most useful measures are:

- **68 gate types registered; 19 have explicit evidence-return routes in the default provider
  session; 49 have no route.** The 19 are potentially reachable paths, not 19 proven-complete
  features. Several mappings have correctness gaps.
- **All 22 platform gate types lack default evidence wiring:** eight Kubernetes, six Azure
  Container Apps, and eight VM types. Generic runtime and comparison gates also have gaps.
- **540 tests pass; three are skipped.** Aggregate statement coverage is 87.05%, but the Action's
  production service composition has 0% coverage and the default provider session has 31.33%.
- **The checked-in Action bundle does not match the current source.** The latest query-fingerprint
  correction is present in source and absent from the artifact executed by `action.yml`.

Evidence: [default provider session](../packages/providers/src/session.ts),
[gate registration](../packages/gates/src/register-all.ts),
[Action entrypoint](../action.yml), and fresh validation results below.

## What is already strong

- **Clear product boundary.** Read-only evaluation, deployment ownership outside the tool, no
  hosted backend, and a shared execution-result model fit the intended SRE/CD use case.
- **Good architectural separation.** Configuration, providers, evaluators, decisions, and reporters
  are separate packages. The missing integration can be repaired without replacing the core design.
- **Useful safety mechanisms.** Workspace-contained evidence loading, bounded responses,
  authentication/authorization error handling, concurrency scheduling, redaction, and cancellation
  abstractions exist and have automated coverage.
- **Careful report publication.** The file writer stages reports, applies a shared byte budget,
  uses restricted file permissions, and supports rollback on publication failure.
- **Broad evaluator and adapter testing.** Unit, property, security, failure-injection, performance,
  and contract tests provide a strong foundation for adding real product-composition coverage.
- **Release machinery exists.** Pinned Actions, protected publication, checksums, SBOM validation,
  attestations, and immutable-release preconditions are implemented in workflow code. Actual
  publication and repository settings were not verified during this review.

References: [service](../packages/core/src/application/service.ts),
[report writer](../packages/reporters/src/files.ts),
[security tests](../tests/security), and [release workflow](../.github/workflows/release.yml).

## Completeness by product area

| Area                                   | Current state                                           | Missing before the advertised contract is complete                                                                                  |
| -------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Offline validation and planning        | Implemented; no provider calls needed                   | Gate-specific and nested schemas; reject unsupported compositions before execution.                                                 |
| CLI commands                           | All five commands exist                                 | Runnable quickstart, accurate examples, richer discovery, and consistent accepted exit-code behavior.                               |
| GitHub Action                          | Inputs, outputs, reports, checks, and comments exist    | Current bundle, policy parity, publication switches, and cancellation-safe publication.                                             |
| Gate catalogue                         | Broad evaluator coverage                                | Actual acquisition for 49 registered types; truthful support metadata.                                                              |
| Prometheus/Mimir, Loki, Tempo, Grafana | Clients and some default routes exist                   | Gate-specific normalization, correct identity/sample semantics, comparison acquisition, and representative public-entrypoint tests. |
| Kubernetes/AKS, Container Apps, VMs    | Adapters and platform evaluators exist                  | Connect target/provider configuration to runtime acquisition and evaluators through the CLI and Action.                             |
| File and signed deployment evidence    | Loaders, parsers, and signature verifier exist          | Wire signed deployment verification into the default workflow; tighten identity, time, and synthetic-result validation.             |
| Observation and regression             | Scheduling and comparison evaluators exist              | Default session sampling and baseline/candidate acquisition that honor policy windows and sample requirements.                      |
| Decision integrity                     | Central aggregation and evidence states exist           | Validity-aware coverage, complete identity evidence, and order-independent mixed-state handling.                                    |
| JSON, Markdown, JUnit, SARIF           | All renderers exist                                     | Consistent run-level failure representation and XML-safe diagnostics.                                                               |
| Security and execution bounds          | Significant controls implemented                        | Address-classification/DNS boundary fixes, complete cancellation, and enforcement of accepted resource limits.                      |
| Packaging and distribution             | Source build, Action bundle, CLI archive workflow exist | Source/artifact parity, release version preparation, and independent rebuild verification.                                          |

## Prioritized findings

P1 means a blocker for general production deployment enforcement. P2 means a material product
gap to close before broad adoption. Findings below were re-inspected in current source; only the
checks listed under validation were executed. Static findings are not presented as live exploits.
Earlier backlog IDs refer to the [11 October audit](product-audit-gaps.md).

### 1. P1 — Most advertised gates cannot acquire evidence through the product

Both the [CLI service](../packages/cli/src/main.ts) and
[Action service](../packages/action/src/service.ts) initialize `createPolicyProviderSession`.
That session does not import or compose the runtime adapters and ends with
`unsupported(gateType, ...)` at `packages/providers/src/session.ts:723`.

Its 19 explicit return routes cover policy/identity checks, selected Grafana gates, HTTP/assets,
metric thresholds, telemetry presence/service graph, and four file-evidence types. The other 49
registered types cannot complete through this composition. This also affects the signed deployment
and baseline/comparison workflows central to post-deployment confidence.

**Impact:** A policy can refer to a registered, documented gate and still receive
`CAPABILITY_UNSUPPORTED` at runtime. Adapter unit tests do not establish product support.

**Acceptance:** Every advertised supported gate has a configuration-to-acquisition-to-decision
path. Unsupported combinations fail offline validation with actionable diagnostics. For each
advertised runtime/provider family, exercise one success and one expected failure through the
default CLI and Action compositions and assert reports and outputs. **Backlog:** OG-AUDIT-001.

### 2. P1 — The shipped Action omits the latest correctness fix

`packages/core/src/evidence/fingerprint.ts` now preserves quoted query literals. The checked-in
`dist/index.js:132` still collapses whitespace using regular expressions, including whitespace
inside quoted labels. Distinct queries such as `up{job="a b"}` and `up{job="a  b"}` therefore
remain capable of sharing an evidence-cache key in the Action artifact.

**Verification:** `npm run bundle` succeeded but changed both tracked Action bundle files;
the subsequent comparison exited 1. The original tracked artifacts were restored after inspection.
`verify:bundle` passes because it checks artifact composition, not freshness against source.

**Impact:** Source tests validate behavior that consumers of the checked-in Action do not receive.
The CI workflow's rebuild-and-diff requirement would reject this state.

**Acceptance:** Rebuild and include both tracked Action artifacts with the source fix; require a
clean rebuild diff and run the quoted-query regression against the shipped artifact.
**Backlog:** OG-AUDIT-005 is fixed in source, still open for the shipped Action.

### 3. P1 — Some normalized evidence substitutes assumptions for measurements

In `packages/providers/src/session.ts`:

- `:385` uses vector sample count as request count for `minimum_total_requests`.
- `:580` treats SLO existence as proof that SLO labels match identity.
- `:601` maps one burn-rate value to both short and long windows, with an infinite threshold
  fallback when the expected scalar field is absent.
- `:495` reports zero unknown-peer percentage without measuring it.

**Impact:** A valid provider response can be translated into the wrong assertion input. A healthy
decision may reflect fabricated defaults rather than the workload facts required by the policy.

**Acceptance:** Each route has a typed evidence contract; unknown values remain unknown; request
counts, identity labels, burn windows, and peer completeness come from appropriate measurements.
Adversarial fixtures must fail the corresponding assertion. **Backlog:** OG-AUDIT-013.

### 4. P1 — Coverage can report evidence as sufficient without validating its capability or state

`coverageRequirements` in `packages/core/src/application/service.ts:148` matches only the provider
name. It does not verify that evidence is valid, fresh, or acquired for the required capability.
The projected evidence reference also omits state/capability information needed for that check.

**Impact:** Evidence coverage can be overstated. Where missing-evidence policy permits warnings,
the coverage threshold cannot reliably enforce the independent minimum-evidence requirement.

**Acceptance:** Satisfaction requires the expected provider and capability plus valid, fresh,
identity-matched evidence. Stale, missing, unavailable, and mismatched-capability fixtures cannot
satisfy coverage. **Backlog:** OG-AUDIT-006.

### 5. P1 — Identity and synthetic checks have false-pass conditions

`packages/gates/src/post/workload.ts:19` accepts two matching release-identity values even when the
third expected source is missing. It compares sanitized/truncated identities rather than the full
original values. `telemetry-identity.ts` uses the same sanitization for equality.

`packages/providers/src/evidence/synthetic.ts:46` recognizes JUnit `<failure>` but not `<error>`;
its regex can also match testcases inside comments. `packages/gates/src/post/synthetic.ts:10`
returns no assertions when required tests are empty, and the execution layer treats an empty
assertion set as passed.

**Impact:** A missing attestation, colliding display identity, errored test, or unconstrained test
selection can fail to block a release when it should.

**Acceptance:** Compare complete raw identities and require every policy-mandated source. Parse
JUnit structurally, reject malformed/comment-only evidence, treat errors as failures, and require
meaningful test assertions. **Backlog:** OG-AUDIT-007 and OG-AUDIT-008.

### 6. P1 — Network validation does not fully enforce the documented boundary

`packages/providers/src/transport/url-policy.ts:52` recognizes dotted IPv4-mapped IPv6 but does not
decode equivalent hexadecimal mapped forms. An otherwise allowlisted address such as
`https://[::ffff:7f00:1]` can evade the private/loopback classification. Hostname validation resolves
DNS separately from the connection subsequently opened by `fetch`.

**Impact:** The private-address restriction is incomplete. DNS validation is also vulnerable to
address changes between checking and connecting. Exploitability depends on allowlist/configuration
control and resolver behavior; no live network attack was attempted.

**Acceptance:** Classify canonical addresses, including all mapped representations; bind validated
DNS results to connection establishment; test private/metadata destinations and DNS changes.
**Backlog:** OG-AUDIT-002.

### 7. P1 — Observation, cancellation, and accepted execution limits are incomplete

The default provider session supplies no `sample` callback. In
`packages/core/src/application/run-phase.ts:69`, the observation sampling loop runs only when that
callback exists. Configured minimum successful samples therefore do not establish sustained
observation in the default product composition.

`packages/providers/src/transport/guarded-fetch.ts:234` performs DNS validation before setting up
its request timeout and cancellation listener. Body reading does not explicitly race cancellation;
absolute deadlines are checked for retry delay rather than across the complete lifecycle.
`maximum_gates`, `maximum_queries`, and `maximum_total_runtime` are accepted by the schema but are
not enforced in execution. `failFast` is planned but not used by the scheduler.

The Action also lacks a final cancellation guard around summary/check/comment publication after
local report writing (`packages/action/src/main.ts:57`).

**Impact:** A configured observation window can provide less evidence than expected; network work
can outlive intended bounds; cancellation during late publication can still produce success output.

**Acceptance:** Prove configured sample/window behavior through the default service. Apply one
effective deadline across DNS, connection, redirects, reads, and retries; enforce or reject accepted
limits; prevent successful publication after cancellation. **Backlog:** OG-AUDIT-003, 009, 011, 018.

### 8. P1 — Validated policies can contain unsupported or ignored semantics

The policy envelope is strict, but nested runtime/provider/source/assertion/security records remain
generic records. `packages/gates/src/evaluation.ts:22` only checks that a gate definition is an
object. A misspelled assertion or incompatible provider option can therefore survive validation.

CLI no-data translation reads policy values (`packages/cli/src/main.ts:91`); Action translation
hardcodes blocking `fail` (`packages/action/src/service.ts:73`). Configurable decision exit codes
are accepted while the CLI uses fixed mappings. Action reporting is activated by token presence,
without consulting configured publication switches.

**Impact:** Operators cannot treat successful validation as confirmation that their intended policy
will be honored, and the same policy can behave differently locally and in CI.

**Acceptance:** Add gate/provider/runtime-specific validation, share execution-policy translation,
and either honor each accepted setting or reject it. Verify CLI/Action parity on missing evidence,
durations, outcome mapping, and explicit publication choices. **Backlog:** OG-AUDIT-004, 010, 014, 023.

### 9. P1 — Report formats disagree about run-level execution failures

`packages/reporters/src/junit.ts:32` derives failures only from gate results. A run-level error with
zero gates produces a zero-test suite with no failures. SARIF only projects located gate diagnostics
and omits run-level execution status (`packages/reporters/src/sarif.ts:18`).

**Impact:** A downstream report consumer can miss an error that is visible in canonical JSON or
the process exit code.

**Acceptance:** A zero-gate execution error is represented as an unsuccessful run in every format;
test configuration, provider initialization, reporting, and cancellation failures. Remove XML 1.0
invalid characters from JUnit diagnostics. **Backlog:** OG-AUDIT-012 and OG-AUDIT-020.

### 10. P2 — Tests exercise components more thoroughly than the shipped workflows

The end-to-end harness injects test-owned normalized evidence
(`tests/end-to-end/harness.ts:93`). The public CLI scenario uses a local identity check. Kind and
Azure integration tests call adapters directly, so even successful live tests would not establish
that the public services route runtime gates correctly.

**Acceptance:** Add a smaller, mandatory suite using the default compositions against deterministic
fake servers/files. Assert the final decision, exit/Action failure, identity, coverage, diagnostics,
and four reports. Include stale, unauthorized, malformed, cancelled, and unsupported cases.
**Backlog:** OG-AUDIT-021. Start alongside findings 1–3, so wiring fixes have meaningful proof.

### 11. P2 — The documented first-run journey fails before demonstrating value

Fresh runs of the README commands produced:

```text
validate --config examples/observability-gate.yml
CONFIG_SCHEMA: Missing required environment variable: TARGET_ID

explain telemetry.release_identity
Unknown gate: telemetry.release_identity
```

The full reference policy is useful as a catalogue, but it requires environment configuration and
external evidence. It does not provide a ready first-run demonstration. Explain/catalog output is
also too sparse to replace reading the reference YAML and source.

**Acceptance:** Provide an offline runnable sample with expected pass and expected-failure results;
test every quickstart command; correct the gate identifier; document prerequisites for live policies.
Expand gate discovery to expose the actual evidence/assertion contract. **Backlog:** OG-AUDIT-024,
025, plus the newly confirmed invalid README explain identifier.

### 12. P2 — Release preparation and reproducibility remain partly unproven

The root package remains at version `0.0.0`. The release workflow requires the tag to equal the
package version, so a `v1.0.0` release needs deliberate version preparation. Its reproducibility
check archives the same `dist/cli` build twice (`.github/workflows/release.yml:92`), proving
deterministic packaging rather than independent reproducible compilation/bundling.

**Acceptance:** Prepare consistent release metadata, rebuild all shipped artifacts, compare two
independent clean builds, and validate archive installation and documented commands in a clean
environment. Verify actual publication/settings when a release is authorized.
**Backlog:** OG-AUDIT-022; bundle freshness is separately covered by finding 2.

## Validation performed

The working tree was clean before review. Node.js `v24.21.0` and npm `11.19.0` were already
installed. Existing dependencies were used; no dependency installation or changes were made.

| Check                                              | Fresh result                                                  | What it establishes                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `npm run ci`                                       | Pass, exit 0                                                  | Formatting, lint, typecheck, coverage tests, and all seven workspace builds pass.                          |
| Coverage suite within CI                           | 68 files passed, two skipped; 540 tests passed, three skipped | Statement coverage 87.05%; branches 74.13%; functions 79.91%; lines 87.37%.                                |
| `npm run verify:bundle`                            | Pass, exit 0, before rebuild                                  | Existing Action/CLI artifacts satisfy composition checks; this does not establish freshness.               |
| `npm run verify:read-only`                         | Pass, exit 0                                                  | Scanner found no prohibited mutation or remote-shell APIs in 153 production files and both bundles.        |
| `npm run bundle`                                   | Build succeeds                                                | Rollup emits artifacts, with warnings; compilation/bundling is functional.                                 |
| Compare rebuilt tracked Action artifacts with HEAD | Fail, exit 1                                                  | `dist/index.js` and `dist/index.js.map` drift from source. Original tracked files restored after checking. |
| README `validate` command                          | Fails with missing `TARGET_ID`                                | Quickstart has undeclared setup prerequisites.                                                             |
| README `explain telemetry.release_identity`        | Fails with unknown gate                                       | Documented identifier is not a registered type.                                                            |
| CLI `catalog --json`                               | Pass                                                          | Catalogue discovery works; registration is not proof of acquisition support.                               |

**Limits of this review:** No live Grafana, Kubernetes, Azure, or production credentials/endpoints
were used. Kind and Azure opt-in tests were skipped. The full suite includes the default end-to-end,
security, property, and performance cases; mutation tests were not rerun. Release assets, GitHub
repository settings, Marketplace distribution, and clean-machine dependency installation were not
checked remotely. Existing audit reproductions were not all rerun; current source was inspected
for the findings highlighted here. Performance results are test-fixture evidence, not field-scale
capacity validation.

## Recommended completion sequence

| Order | Deliverable                                                         | Exit condition                                                                                                                                        |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Repair shipped-artifact parity and declare an honest support matrix | Source/bundle diff clean; users can identify runnable gate/provider/runtime combinations.                                                             |
| 2     | Complete one Kubernetes/AKS pre/post vertical workflow              | Real default services acquire runtime, release identity, telemetry, and comparison evidence; healthy and unhealthy scenarios produce correct outputs. |
| 3     | Close decision-integrity and network blockers                       | Findings 3–9 covered by targeted regressions, with no false-pass paths or ignored safety settings in the supported scope.                             |
| 4     | Expand composition to remaining advertised runtimes                 | Container Apps, Azure VM, Linux VM, and Windows VM have the same success/failure evidence through CLI and Action.                                     |
| 5     | Complete onboarding and release proof                               | Copy/paste quickstart works; clean build/install and artifact checks pass; supported release metadata is consistent.                                  |

For the first usable release, prioritize a fully proven Kubernetes/AKS workflow over expanding the
gate catalogue. If a narrower release is chosen, explicitly reduce its documented support contract
and reject unsupported configurations before execution. The broader multi-runtime claim remains
incomplete until its workflows pass the same acceptance criteria.

## Relationship to the earlier audit

The [earlier audit](product-audit-gaps.md) contains 26 detailed backlog items against `2337d37`.
The current HEAD adds that document and changes only query fingerprinting and its tests. The
fingerprinting fix closes OG-AUDIT-005 in source; the stale Action artifact prevents considering
it shipped. The other items have no intervening source changes. Retain that document as the
detailed engineering backlog and use this report for the current product/readiness assessment.

No additional requirement for a dashboard, hosted service, deployment executor, automatic rollback,
or persistent evidence database is introduced here: those are outside the declared product scope.
