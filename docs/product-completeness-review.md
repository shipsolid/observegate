# ObserveGate product completeness review

## Remediation plan

User request: close the gaps identified in this report. Preserve the read-only product boundary,
the documented decision/exit-code contract, and the existing package dependency direction.

- [ ] Enforce configured Grafana readiness assertions; normalize documented alert payloads and
  resolve routing/mute evidence safely. Prove policy violations fail and healthy evidence passes.
- [ ] Select Kubernetes containers and PDBs by workload identity, preserve controller-specific
  semantics, and extend regression coverage for multi-container and non-Deployment workloads.
- [ ] Align cardinality/volume budgets with their public schema; reject unsupported baseline modes
  rather than silently interpreting them; publish a generated policy JSON Schema.
- [ ] Preserve coverage blocking reasons and terminal Action error outputs; add opt-in safe
  execution diagnostics and provider timing information.
- [ ] Complete a reproducible pre/deploy/post example with authentication, signed evidence,
  shell-safe input handling, and failure artifact retention; align licence and support claims.
- [ ] Diagnose memory-budget failures at source; run CI, security/property/mutation/performance,
  bundle/read-only, and independent-build checks. Add vendor-shaped compatibility coverage.
- [ ] Replace this report's open findings with a closure matrix and actual validation evidence.
  Keep live certification and controlled-pilot outcomes explicitly unverified until observed.

Implementation runs in the requested checkout so the existing untracked review artefacts remain
available. No commit, push, publication, or production mutation is authorized by this plan.

## Assessment

**Verdict: substantial implementation, incomplete product contract; hold broad production release.**

ObserveGate has a credible foundation for an evidence-driven deployment gate: a shared engine,
strict policy parsing, live provider adapters, bounded execution, four report formats, and a
packaged CLI and GitHub Action. It is suitable for controlled evaluation with individually verified
policies. It is not yet dependable as a general production deployment authority across its advertised
gate catalogue and runtimes.

The main gap is **semantic correctness**. Some accepted policy assertions are ignored, some checks
inspect the wrong workload evidence, and a Grafana adapter expects fields absent from its selected
API. These can create false confidence or block healthy releases. Adding more gate names would not
resolve this gap.

No defensible single completeness percentage follows from this review. Registration coverage,
test coverage, specification conformance, and production compatibility measure different things.

## Scope and evidence

- **Reviewed:** local repository at `21bd3d6`, version `0.1.0`, on 22 October 2026, using Node.js
  `24.21.0` and npm `11.19.0`.
- **Baseline:** current README, product specification, implementation plan, reference policy,
  production source, tests, workflow examples, and release scripts.
- **Method:** source review, automated checks, bundle inspection, direct parser/evaluator probes,
  and comparison of the Grafana alert adapter with official API documentation.
- **Assumption:** this is the standalone ShipSolid/lab product in this repository. No McCain
  production environment or internal requirements were assumed.
- **Limits:** no live Grafana Cloud, Azure, AKS, or VM compatibility certification; no publication,
  remote repository settings inspection, penetration test, or external dependency vulnerability
  audit. Local passing tests do not establish those outcomes.
- **Review changes:** this report and a local reproduction harness only; production behavior was
  not changed.

The catalogue contains **68 distinct gate types covering 86 reference-policy instances**, not 86
independent implementations. Reference registration tests are useful structural checks, but they do
not prove that every accepted assertion influences a decision.

## Capability completeness

| Area                                   | Assessment                                                           | Evidence and remaining work                                                                                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product boundary and architecture      | Substantially complete                                               | Clear read-only, backend-free model; separate core, config, gates, providers, reporters, CLI, and Action packages.                                                                         |
| Policy validation and planning         | Implemented, semantically incomplete                                 | Strict fields, references, scoped interpolation, acquisition checks, and offline planning exist. Accepted assertion fields do not consistently map to evaluator behavior.                  |
| Core execution and decisions           | Strong foundation                                                    | Deadlines, retries, cancellation, concurrency, evidence states, and coverage aggregation are implemented and tested. Coverage failure reasons are lost at the application/report boundary. |
| Pre-deployment readiness               | Partial                                                              | Real acquisition exists, but dashboard, alert, and SLO checks contain hardcoded expectations that ignore public policy fields.                                                             |
| Metrics, logs, traces, and comparisons | Broad implementation; compatibility remains conditional              | Prometheus/Mimir, Loki, Tempo, explicit comparison queries, and identity checks exist. Automatic healthy-baseline discovery is not wired into production acquisition.                      |
| Grafana assets and reliability         | Partial; adapter correction required                                 | Dashboard and alert/SLO client code exists. Alert-rule normalization conflicts with the documented provisioning response. Notification routing is also simplified.                         |
| Kubernetes/AKS                         | Partial beyond simple Deployment workloads                           | Real read clients and manifest analysis exist. Container selection, PDB association, and non-Deployment controller semantics need correction.                                              |
| Container Apps and VMs                 | Implemented with explicit prerequisites                              | Control-plane readers and normalized guest-file evidence exist. VM evidence collection/signing remains user-owned; live Azure checks are opt-in.                                           |
| Cardinality and ingestion budgets      | Incomplete                                                           | Accepted per-dimension budget assertions do not match the scalar evaluator contract.                                                                                                       |
| Reporting and GitHub integration       | Mostly implemented                                                   | JSON, Markdown, JUnit, SARIF, outputs, summaries, optional checks, and PR comments exist. Failure diagnostics and reporting-error output consistency need work.                            |
| Security controls                      | Strong defensive foundation                                          | Guarded transport, SSRF tests, file confinement for evidence, signing checks, redaction, and no-shell verification exist. Workflow example and real API contract gaps remain.              |
| Onboarding and documentation           | Good offline entry; incomplete operational entry                     | Offline demo works. The exhaustive policy is a catalogue requiring customization; the advertised deployment workflow omits essential setup/evidence production.                            |
| Distribution and release assurance     | Local artifact verification passed; release qualification incomplete | Independent builds and archive smoke passed. The memory-budget check fails; published settings, attestations, and live-provider support remain unverified here.                            |

## Findings

### Bugs and release blockers

**B1 — High: readiness gates can pass policies they do not satisfy.**

- Dashboard evaluation ignores `minimum_panels`, `required_panel_signals`,
  `required_template_variables`, and the normalized title-match result. It instead requires four
  panels and two fixed variable names.
- Reproduced: a policy requiring eight panels, RED/saturation coverage, a `cluster` variable, and
  a checkout title passed with four unrelated panels, the wrong title, and no `cluster` variable.
- Alert evaluation similarly passes two enabled rules when `minimum_enabled_rules` is five;
  `forbid_no_data_ok_on_critical_rules` is not evaluated. SLO definition checks also hardcode
  objective/window bounds instead of applying their public configuration.
- **Impact:** a successful pre-deployment gate can overstate operational readiness.
- **Required correction:** enforce every accepted assertion or reject unsupported assertions at
  validation; add cases where changing each policy threshold changes the result.
- **Evidence:** [assets.ts:46](../packages/gates/src/pre/readiness/assets.ts#L46),
  [assets.ts:74](../packages/gates/src/pre/readiness/assets.ts#L74),
  [assets.ts:131](../packages/gates/src/pre/readiness/assets.ts#L131), and
  [gate-contracts.ts:318](../packages/config/src/schema/gate-contracts.ts#L318).

**B2 — High: Kubernetes manifest checks can validate a sidecar instead of the selected application.**

- The manifest selector has no container-name field, and parsing always uses `containers[0]`.
  The documented `workload.container_env` never reaches this parser.
- Reproduced: a first sidecar with resources supplied the checked image/resources while the second
  application container lacked resources. The resources gate passed.
- **Impact:** probes, resource requirements, security settings, and image checks can describe the
  wrong container in an otherwise correctly selected workload.
- **Required correction:** carry the configured container through acquisition and select it by
  name; reject missing or ambiguous selections.
- **Evidence:** [manifest.ts:4](../packages/providers/src/runtime/kubernetes/manifest.ts#L4),
  [manifest.ts:61](../packages/providers/src/runtime/kubernetes/manifest.ts#L61),
  [artifacts.ts:282](../packages/providers/src/resolvers/artifacts.ts#L282), and
  [Kubernetes guide:19](runtimes/kubernetes.md#L19).

**B3 — High: an unrelated PDB can falsely prove disruption protection.**

- Parsing selects the first PDB in the workload namespace without matching its selector to the
  workload's pod labels. The resources gate checks only that a budget object exists.
- Reproduced: a PDB selecting `another-service` satisfied the two-replica checkout resources gate.
- **Required correction:** establish selector association and evaluate the applicable disruption
  policy; test unrelated, absent, overlapping, and matching selectors.
- **Evidence:** [manifest.ts:76](../packages/providers/src/runtime/kubernetes/manifest.ts#L76) and
  [pre.ts:219](../packages/gates/src/platform/kubernetes/pre.ts#L219).

**B4 — High: Grafana alert readiness uses an incompatible API payload contract.**

- The client reads `/api/v1/provisioning/alert-rules`. Its normalizer requires `state`, `health`,
  and `lastEvaluation`, and reads the runbook URL from labels.
- The documented provisioning model provides rule configuration and annotations; it does not
  supply those required evaluation-state fields. Reproduced locally: a rule constructed with the
  documented provisioning fields is rejected by the normalizer.
- **Impact:** a successful API read can become invalid evidence and block readiness. Rule
  configuration and evaluation health require separate acquisition contracts.
- **Required correction:** normalize the selected endpoint's actual schema, read runbooks from
  annotations, preserve no-data behavior, and acquire evaluation state separately when needed.
- **Evidence:** [client.ts:74](../packages/providers/src/grafana/client.ts#L74) and
  [alerts.ts:19](../packages/providers/src/grafana/alerts.ts#L19). API comparison:
  [Grafana provisioning model](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/http-api-provisioning/#provisionedalertrule).
  This is a documented-contract reproduction, not a live-stack test.

**B5 — Medium: cardinality and volume budgets cannot express the evaluator's positive budget.**

- The public schema accepts limits such as `new_metric_series.less_than_or_equal` and per-signal
  growth percentages. Acquisition instead maps `estimate` and `assertions.budget`; evaluation
  defaults the absent `budget` to zero.
- Reproduced: estimate 100 fails against zero despite an accepted 500-series limit. Adding the
  runtime-required `budget: 500` fails public policy parsing as an unknown field.
- **Impact:** the documented FinOps controls do not implement their advertised dimensions and can
  produce misleading warnings. There is no supported policy workaround for the scalar budget.
- **Required correction:** align schema, evidence acquisition, units, and comparisons for each
  supported dimension; test under-budget and over-budget policies through the public composition.
- **Evidence:** [gate-contracts.ts:2386](../packages/config/src/schema/gate-contracts.ts#L2386),
  [gate-contracts.ts:2486](../packages/config/src/schema/gate-contracts.ts#L2486),
  [telemetry.ts:598](../packages/providers/src/resolvers/telemetry.ts#L598), and
  [telemetry-budget.ts:9](../packages/gates/src/pre/risk/telemetry-budget.ts#L9).

**B6 — Medium: advertised Kubernetes workload support applies Deployment-only rollout rules.**

- The rollout gate unconditionally requires `Progressing=True` and `Available=True`. Healthy
  StatefulSet and DaemonSet evidence does not generally carry those Deployment conditions.
- A local evaluator probe with fully updated/available replicas and no Deployment conditions
  fails both assertions. Static rollout parsing also reads `spec.strategy` rather than the other
  controllers' `spec.updateStrategy`.
- **Required correction:** implement per-controller semantics and realistic controller fixtures,
  or explicitly narrow supported gates to Deployment until that work is complete.
- **Evidence:** [post.ts:28](../packages/gates/src/platform/kubernetes/post.ts#L28),
  [manifest.ts:82](../packages/providers/src/runtime/kubernetes/manifest.ts#L82), and
  [runtime support claim](runtimes/kubernetes.md).

**B7 — High if copied into a privileged pipeline: the deployment example interpolates input into shell source.**

- `${{ inputs.release_id }}` appears directly inside the Helm `run` script. Shell substitutions
  in the expanded value can execute despite the surrounding double quotes.
- **Impact:** the example introduces a shell-injection path on a deployment runner. Exploitability
  depends on who can invoke the workflow and control that input; this is not an observed compromise.
- **Required correction:** pass the release ID through an environment variable, validate its
  allowed digest/release format, and expand the variable as a quoted argument.
- **Evidence:** [pre-and-post.yml:84](../examples/workflows/pre-and-post.yml#L84).

**B8 — Medium: distributed licence identity is inconsistent.**

- `LICENSE` grants MIT terms; the README and generated CLI package declare Apache-2.0. The archive
  includes the MIT file alongside Apache package metadata.
- **Required correction:** choose the intended licence and align the source, documentation,
  generated manifest, and release metadata before distribution.
- **Evidence:** [LICENSE:1](../LICENSE#L1), [README:166](../README.md#L166), and
  [rollup.config.js:69](../rollup.config.js#L69).

### Risks and incomplete product experiences

| ID  | Gap                                                          | Consequence and next action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Real-provider compatibility is under-evidenced               | Most contracts use synthetic fixtures. Azure and kind scenarios are opt-in; kind covers Deployment. Add vendor-shaped contract fixtures and a declared tested-version matrix for Grafana, Prometheus/Mimir, Loki, Tempo, Kubernetes controllers, and Azure runtimes. B4 demonstrates why this matters.                                                                                                                                                                                                                                          |
| R2  | Deployment onboarding is incomplete                          | The example references a root policy and `deploy/chart`, supplies no kubeconfig/auth preparation, and captures a Helm manifest without producing the signed deployment attestation used by relevant gates. Pre-gate report upload also lacks `if: always()`. Mark this as a template and provide one fully specified authenticated pre/deploy/post path with evidence production and failure artifact retention. See [workflow example](../examples/workflows/pre-and-post.yml) and [deployment evidence requirements](deployment-evidence.md). |
| R3  | Automatic baseline discovery remains a specification promise | The tested `selectBaseline` helper is not wired into production acquisition, which requires an explicit baseline. Accepted strategy/lookback/exclusion fields do not implement the design's automatic selection. Keep explicit mode as the supported contract and reject unsupported modes, or complete the acquisition path. See [comparison.ts:25](../packages/providers/src/resolvers/comparison.ts#L25), [baseline.ts](../packages/gates/src/post/comparison/baseline.ts), and [provider documentation](providers.md).                      |
| R4  | Failure explanations and Action outputs are incomplete       | Aggregation creates evidence-coverage blocking reasons, but the service drops them and emits empty top-level diagnostics. Reporting/summary errors can reach the Action catch before decision outputs are set. Preserve safe decision reasons and publish a consistent terminal error contract. See [aggregate.ts:112](../packages/core/src/decisions/aggregate.ts#L112), [service.ts:283](../packages/core/src/application/service.ts#L283), and [Action main.ts:93](../packages/action/src/main.ts#L93).                                      |
| R5  | Notification routing checks simplify the real policy tree    | Normalization searches immediate routes only and expects synthetic `mute_windows`; it does not resolve nested/inherited routing or fetch actual mute-interval definitions. An unchecked interval can appear unmuted. Implement these semantics or return unsupported/insufficient evidence. See [alerts.ts:63](../packages/providers/src/grafana/alerts.ts#L63) and [Grafana route/mute models](https://grafana.com/docs/grafana/latest/alerting/set-up/provision-alerting-resources/http-api-provisioning/#route).                             |
| R6  | Memory-budget validation fails                               | Two unrestricted local runs exceeded the configured peak RSS ceiling. Independent-build and archive smoke verification passed outside the sandbox. Resolve or explain the memory-budget discrepancy on the intended release runner and retain the result; published release settings and attestations were not inspected.                                                                                                                                                                                                                       |

### Maintainability and documentation gaps

- **Contract drift:** the specification requires the exhaustive reference YAML to validate without
  modification, while current README/provider docs describe required customization. Reconcile the
  acceptance criteria with the supported runnable samples. See
  [specification:1578](observegate-spec.md#L1578).
- **Editor and operator support:** generated JSON Schema, an opt-in structured diagnostic event
  stream, and provider-level timings are described in specification sections 37 and 39 but are not
  exposed by the current CLI/report contract. Either deliver them or explicitly defer them.
- **Authentication documentation:** provider metadata advertises bearer/basic authentication,
  while policy validation rejects username/password settings. Correct the capability source so
  regenerated docs describe usable authentication. See
  [capabilities.ts:14](../packages/providers/src/capabilities.ts#L14) and
  [validate-contract.ts:485](../packages/config/src/schema/validate-contract.ts#L485).
- **Test emphasis:** current mutation testing targets six files covering core decisions,
  assertions, freshness, interpolation, and redaction. It does not mutate the readiness evaluators
  or provider resolvers responsible for the reproduced defects. Add behavioral contract tests
  before increasing the catalogue's size.

### What is strong

- The read-only boundary is explicit and enforced in source and bundles; evidence acquisition is
  separated from assertion evaluation.
- Evidence absence, invalidity, staleness, provider failure, cancellation, and coverage have typed
  handling rather than being silently converted into healthy values.
- The offline example exercises both a passing release and an expected identity failure through
  CLI and Action compositions. Generated documentation has drift checks.
- The release design includes pinned Actions, locked dependencies, standalone packaging, SBOM,
  attestations, immutable-release preconditions, and independent build comparison.

Automatic rollback, traffic shifting, a hosted backend, persistent release history, arbitrary
plugins, automatic instrumentation/resource creation, incident mutation, and an approval UI are
explicitly deferred. Their absence is **not** a completeness defect for this product's current scope.

## Validation results

| Check                                                      | Observed result                                                                                                                                                                                                     | Interpretation                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run ci`                                               | Passed: formatting, lint, type checking, coverage, and workspace build. **835 tests passed; three skipped.**                                                                                                        | Confirms the existing suite on this checkout. Skips include live Azure/kind and the sandbox-limited memory case.                                                                                                                  |
| Coverage                                                   | Statements 89.48%; branches 77.64%; functions 87.10%; lines 89.80%.                                                                                                                                                 | Whole-run figures include scripts/test helpers; not a percentage of product completeness.                                                                                                                                         |
| `npm run bundle`                                           | Passed; Rollup emitted dependency warnings.                                                                                                                                                                         | Both Action and standalone CLI were generated. No substantive tracked bundle diff remained.                                                                                                                                       |
| `npm run verify:bundle`                                    | Passed.                                                                                                                                                                                                             | Structural/relocatability checks passed; does not replace standalone behavioral smoke tests.                                                                                                                                      |
| `npm run verify:read-only`                                 | Passed: 166 production files plus both bundles scanned.                                                                                                                                                             | No prohibited mutation or remote-shell APIs detected by this check.                                                                                                                                                               |
| `npm run test:mutation`                                    | Passed after allowing Stryker's local logging socket: **92.21%**, threshold 85%.                                                                                                                                    | Applies to the configured six-file mutation scope.                                                                                                                                                                                |
| `npm run test:performance`                                 | Sandbox run: four passed, memory test skipped. Full run: four passed, memory test failed at peak RSS growth **70,443,008 bytes**, ceiling **70,254,592 bytes**. Isolated retry also failed at **70,598,656 bytes**. | Reproduced overruns of 184 KiB and 336 KiB. Investigate allocations and the intended runner allowance; these measurements alone do not prove a leak.                                                                              |
| `npm run verify:reproducible -- --offline`                 | Passed outside the sandbox: two independent locked installs/builds matched **nine artifacts**, including CLI archive and SBOM metadata; standalone discovery and pass/fail smoke passed without `node_modules`.     | Two sandbox attempts could not capture the CLI success output; the same archive's smoke helper and the full check passed with normal child-process support. This is an environment limitation, not an unresolved artifact defect. |
| Local standalone CLI and workspace CLI, offline post phase | Both returned `pass` with JSON output.                                                                                                                                                                              | Confirms direct local execution in addition to the independently built archive checks.                                                                                                                                            |
| Review reproduction harness                                | Passed its observation assertions for B1–B6, including Grafana API-shaped normalization.                                                                                                                            | Demonstrates the recorded contract violations; a passing harness means the defects are reproduced, not fixed.                                                                                                                     |

Reproduce the focused observations without network access:

```bash
npm run build
node tests/manual/product-completeness-review.mjs
```

The harness includes a healthy dashboard control and explicit policy/evidence violation probes. It
is an audit artefact, not a regression suite asserting desired fixed behavior. Convert its cases
into normal tests expecting correct outcomes when implementing fixes.

## Recommended release criteria

| Order | Deliverable                                    | Acceptance criterion                                                                                                                                                                                                 |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Restore policy-to-decision correctness         | B1, B2, B3, and B5 fixed. Every supported assertion has a public-path passing case and a violating case; accepted fields cannot be ignored.                                                                          |
| 2     | Establish actual provider/controller contracts | B4 and B6 fixed. Alert fixtures match the selected API schema; multi-container, matching/unrelated PDB, StatefulSet, and DaemonSet cases run through acquisition and evaluation.                                     |
| 3     | Make one deployment journey reproducible       | A documented authenticated workflow validates, runs pre-gates, deploys a user-owned workload, produces required trusted evidence, runs post-gates, and retains reports on failure. Remove shell interpolation in B7. |
| 4     | Align the supported product surface            | Resolve B8; document explicit baseline mode and supported authentication; reconcile reference-policy expectations, schema support, and deferred diagnostic features.                                                 |
| 5     | Complete release verification                  | Resolve or explain the memory-budget failures; obtain passing checks on the intended release runner, including independent-build verification; retain live compatibility evidence for each advertised support tier.  |
| 6     | Run a controlled pilot                         | Measure onboarding effort, provider-query load, execution time, false blocks, missed defects, and remediation clarity on a limited set of user-reviewed policies before enabling broad blocking enforcement.         |

**Release verdict: no for a broadly production-ready claim.** A scoped technical preview is
reasonable with verified policies and explicit support limits. The next milestone should be a
trustworthy, executable deployment journey with complete assertion semantics.
