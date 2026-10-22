# Observability Gate — Design Specification

## Document status

This document is the companion architecture specification for
[observability-gate.yml](./observability-gate.yml). The YAML file is the public policy
contract. This document explains the product model and the implementation boundaries
that make that contract executable.

The detailed implementation task plan is intentionally produced after this design is
reviewed. That review gate prevents implementation tasks from hardening an interface
that still needs correction.

## 1. Executive summary

Observability Gate is a read-only release decision engine for CI/CD workflows. It
answers two different questions at two different moments:

1. **Pre-deployment:** Is this service observable by design, and is it safe to begin a
   change now?
2. **Post-deployment:** Is the intended release actually running, observable, healthy,
   and no worse than the approved baseline?

The product is delivered as both a GitHub Marketplace Action and a local CLI. Both
entry points use one shared engine, one configuration contract, one gate catalogue,
and one result model. There is no hosted control plane and no product-owned database.

The gate collects evidence from four classes of sources:

- Runtime control planes such as Kubernetes and Azure Resource Manager.
- Telemetry systems such as Prometheus or Mimir, Loki, Tempo, and Grafana.
- Build and test artifacts such as SARIF, OTLP captures, signed deployment evidence,
  and synthetic-test results.
- Explicit HTTP probes and repository metadata.

Provider-specific data is converted into normalized evidence. Gates evaluate that
evidence through deterministic assertions. A decision aggregator then produces one
of five outcomes: pass, warn, fail, inconclusive, or error.

The engine never deploys, rolls back, changes traffic, restarts workloads, scales
resources, modifies dashboards or alerts, creates silences, or logs into machines.
The user's workflow remains responsible for every mutation.

## 2. Problem statement

CI/CD systems usually know whether a deployment command completed. They rarely know
whether the released service is observable, whether telemetry identifies the new
release correctly, whether the service is consuming error budget, or whether the
candidate has regressed relative to the previous healthy release.

Teams currently solve this with disconnected scripts:

- A shell query checks a Deployment.
- A PromQL expression checks errors.
- Another step probes an endpoint.
- Someone manually inspects Grafana.
- Platform-specific logic is copied into every repository.
- Missing data is often interpreted as success.
- The workflow reports only a red step without preserving decision evidence.

This makes release policy inconsistent, difficult to audit, and tightly coupled to
one runtime or telemetry vendor.

Observability Gate turns those scripts into a declarative and explainable policy. It
does not replace the deployment system or observability platform. It consumes their
evidence and makes a bounded release decision.

## 3. Product promise

For a given configuration, phase, target, release, and evidence window, the same
inputs must produce the same gate results and the same final decision.

Every result must answer:

- What was evaluated?
- Which evidence was used?
- How fresh was that evidence?
- Which assertion passed or failed?
- Was the gate blocking or advisory?
- Why did the final decision have its outcome?
- What should the operator inspect or do next?

## 4. Intended users

### 4.1 Service teams

Service teams use the Action in application repositories to prevent unobservable or
unhealthy releases from progressing.

### 4.2 Platform engineering teams

Platform teams publish organization defaults, reusable workflow wrappers, standard
queries, provider configuration, and approved gate profiles.

### 4.3 SRE and observability teams

SRE and observability teams define identity contracts, SLO requirements, telemetry
quality rules, failure thresholds, and remediation guidance.

### 4.4 Security and governance teams

Governance teams use signed evidence, read-only execution, provenance validation, and
machine-readable reports to audit release decisions.

## 5. Primary use cases

1. Reject a Kubernetes release whose manifest lacks resource limits, probes, or
   immutable image identity.
2. Reject a release whose telemetry contract test omits service.version or emits
   high-cardinality labels.
3. Prevent a change while a critical alert or high SLO burn rate is active.
4. Validate that an Azure Container Apps revision is provisioned, active, receiving
   traffic, and running the intended image.
5. Validate that an Azure or on-prem VM fleet reports the intended release marker
   without connecting through SSH or WinRM.
6. Confirm that candidate metrics, logs, and traces are present and fresh.
7. Compare error rate, latency, availability, resource usage, dependency latency, and
   telemetry volume with a previous healthy release.
8. Combine runtime, telemetry, alert, SLO, dependency, synthetic, and HTTP evidence
   into one explainable GitHub check.
9. Run the same policy locally before opening or merging a pull request.
10. Export JSON, JUnit, SARIF, and Markdown results for audit and downstream tooling.

## 6. Goals

### 6.1 Functional goals

- Run the same policy in pre-deployment and post-deployment phases.
- Support Kubernetes and AKS, Azure Container Apps, Azure VMs, Linux VMs, Windows
  VMs, and evidence-only generic targets.
- Support Prometheus-compatible metrics, Loki logs, Tempo traces, Grafana Alerting,
  Grafana SLOs, evidence files, synthetic results, and HTTP probes.
- Separate provider acquisition from gate evaluation.
- Normalize runtime evidence so common gates work across platforms.
- Preserve platform-specific checks where normalization would discard important
  semantics.
- Treat telemetry absence and telemetry staleness as explicit evidence states.
- Support blocking and advisory gates.
- Produce actionable, auditable results.
- Operate without a hosted backend.

### 6.2 Quality goals

- Deterministic evaluation.
- Secure defaults.
- Read-only provider permissions.
- Bounded queries and network operations.
- Clear failure semantics.
- Fast feedback through concurrency and evidence reuse.
- Unit-testable components and contract-testable adapters.
- Stable behavior across the Action and CLI.

## 7. Non-goals

Observability Gate does not:

- Deploy applications or infrastructure.
- Implement progressive delivery traffic control.
- Roll back a release.
- Replace Argo Rollouts, Flagger, GitHub Deployments, Azure DevOps, or a CD platform.
- Replace Grafana, Prometheus, Loki, Tempo, an incident system, or an SLO platform.
- Auto-instrument applications.
- Prove runtime observability using static source analysis alone.
- Provide a general-purpose policy language.
- Execute arbitrary shell commands from configuration.
- Load arbitrary dynamic plugins.
- Store long-term release history.
- Require a SaaS control plane.
- Open SSH or WinRM sessions to hosts.
- Mutate dashboards, alerts, silences, or runtime resources.
- Guess thresholds on behalf of a service owner.

## 8. Guiding principles

### 8.1 Evidence before opinion

A gate reports the evidence it evaluated, not only a Boolean answer.

### 8.2 Missing evidence is a state

No data is not automatically healthy. The policy decides whether absence means fail,
warn, skip, or inconclusive.

### 8.3 Normalize facts, not platform semantics

Common facts such as readiness, release identity, instance count, and restart count
are normalized. Platform-specific facts such as Kubernetes rollout conditions or
Container Apps revision traffic remain platform-specific.

### 8.4 Static checks support runtime proof

Static instrumentation analysis can detect likely defects. A runtime OTLP contract
test and post-deployment live telemetry checks prove that signals actually arrive.

### 8.5 Deployment ownership remains external

The engine observes and decides. The workflow deploys, promotes, shifts traffic, or
rolls back.

### 8.6 Secure by construction

The configuration cannot execute a shell, inject a dynamic plugin, or read files
outside the workspace. Provider clients use allowlisted endpoints and read-only
permissions.

### 8.7 Explainability is part of correctness

A correct but opaque failure is not sufficient. Each result includes the assertion,
observed value, expected condition, evidence age, source, and remediation.

## 9. Terminology

| Term | Meaning |
| --- | --- |
| Phase | Either pre_deployment or post_deployment. |
| Target | The selected runtime and workload definition. |
| Provider | A source of runtime, telemetry, file, or HTTP evidence. |
| Adapter | Code that communicates with a provider and returns normalized evidence. |
| Gate | A named policy check containing one or more assertions. |
| Assertion | A deterministic comparison between evidence and an expected condition. |
| Evidence | A typed, timestamped fact with source and provenance. |
| Candidate | The release currently being evaluated. |
| Baseline | The explicitly selected or previously healthy release used for comparison. |
| Blocking gate | A failed, errored, or inconclusive result that blocks the phase. |
| Advisory gate | A result reported to the user without blocking the phase. |
| Skipped gate | A gate that does not apply because its explicit condition is false. |
| Inconclusive | Evaluation ran but the evidence was insufficient for a safe answer. |
| Error | The engine could not perform evaluation because configuration or execution failed. |

## 10. System context

~~~mermaid
flowchart TD
    W["GitHub workflow or local operator"] --> E["Action or CLI entry point"]
    E --> C["Configuration and execution planner"]
    C --> G["Gate engine"]
    G --> A["Runtime and telemetry adapters"]
    A --> S["Kubernetes, Azure, Grafana, telemetry and files"]
    G --> D["Decision aggregator"]
    D --> R["Checks, summary and artifacts"]
~~~

The Action and CLI are adapters around the same application service. Neither entry
point contains gate logic.

## 11. Recommended implementation architecture

The recommended implementation is a TypeScript workspace compiled and bundled for
the GitHub JavaScript Action, with the same packages exposed through a Node-based
CLI.

Why this approach:

- GitHub Action inputs, outputs, annotations, cancellation, and job summaries have
  first-class JavaScript libraries.
- The Action avoids container startup latency.
- One language can implement configuration, providers, gates, CLI, and reports.
- Types can represent normalized evidence and gate contracts.
- A single bundle can be pinned by commit SHA in workflows.
- The CLI can run the exact engine used by the Action.

The design does not require a web service, database, message queue, or remote product
account.

### 11.1 Component view

~~~mermaid
flowchart TD
    EP["Action and CLI"] --> APP["Application service"]
    APP --> CFG["Config loader and planner"]
    APP --> GE["Gate execution engine"]
    GE --> PR["Provider registry"]
    GE --> GR["Gate registry"]
    PR --> EV["Normalized evidence"]
    GR --> EV
    GE --> DA["Decision aggregator"]
    DA --> RP["Reporter registry"]
~~~

### 11.2 Component responsibilities

| Component | Responsibility | Must not do |
| --- | --- | --- |
| Action adapter | Read Action inputs, handle cancellation, set outputs, publish GitHub UI. | Contain provider or gate logic. |
| CLI adapter | Parse commands, environment, output format, and exit codes. | Behave differently from the Action engine. |
| Configuration loader | Parse YAML, interpolate approved environment variables, validate schema and references. | Perform network access. |
| Execution planner | Select phase, target, applicable gates, providers, dependencies, and concurrency groups. | Evaluate assertions. |
| Provider registry | Construct authenticated provider clients and expose capabilities. | Decide deployment outcomes. |
| Evidence coordinator | Deduplicate acquisition, cache within a run, enforce freshness, and attach provenance. | Persist long-term state. |
| Gate registry | Resolve a gate type to its evaluator and input contract. | Create provider clients directly. |
| Gate evaluator | Convert typed evidence and assertions into a GateResult. | Mutate infrastructure or aggregate the phase. |
| Decision aggregator | Apply enforcement and missing-evidence rules to all GateResults. | Re-query providers. |
| Reporter registry | Render JSON, JUnit, SARIF, Markdown, annotations, and outputs. | Change gate outcomes. |
| Redaction service | Remove secrets and sensitive payloads before logs and reports. | Silently alter evidence used for decisions. |

## 12. Repository structure

A monorepo keeps boundaries visible while allowing one release artifact.

~~~text
.
├── action.yml
├── package.json
├── packages
│   ├── core
│   │   ├── domain
│   │   ├── execution
│   │   ├── decisions
│   │   └── errors
│   ├── config
│   │   ├── parser
│   │   ├── schema
│   │   ├── interpolation
│   │   └── validation
│   ├── gates
│   │   ├── common
│   │   ├── policy
│   │   ├── telemetry
│   │   ├── reliability
│   │   ├── kubernetes
│   │   ├── azure-container-apps
│   │   └── vm
│   ├── providers
│   │   ├── prometheus
│   │   ├── loki
│   │   ├── tempo
│   │   ├── grafana
│   │   ├── kubernetes
│   │   ├── azure
│   │   ├── evidence
│   │   └── http
│   ├── reporters
│   │   ├── json
│   │   ├── junit
│   │   ├── sarif
│   │   ├── markdown
│   │   └── github
│   ├── action
│   └── cli
├── fixtures
│   ├── configs
│   ├── providers
│   └── evidence
└── tests
    ├── contract
    ├── integration
    └── end-to-end
~~~

Each package exposes public interfaces. Gate implementations cannot import Action
APIs. Provider implementations cannot import reporter code. The CLI and Action can
only invoke the public application service.

## 13. Public execution model

The engine accepts an ExecutionRequest:

~~~typescript
interface ExecutionRequest {
  configPath: string;
  phase: "pre_deployment" | "post_deployment";
  targetOverride?: string;
  environment: Readonly<Record<string, string | undefined>>;
  cancellationSignal: AbortSignal;
}
~~~

The engine returns an ExecutionResult:

~~~typescript
interface ExecutionResult {
  decision: "pass" | "warn" | "fail" | "inconclusive" | "error";
  phase: "pre_deployment" | "post_deployment";
  target: TargetIdentity;
  release: ReleaseIdentity;
  startedAt: string;
  completedAt: string;
  evidenceCoveragePercent: number;
  gates: GateResult[];
  diagnostics: Diagnostic[];
  links: Record<string, string>;
}
~~~

Entry points translate ExecutionResult into exit codes and user-facing output. They
do not reinterpret it.

## 14. End-to-end execution lifecycle

~~~mermaid
flowchart TD
    L["Load and parse policy"] --> V["Validate schema and references"]
    V --> P["Select phase, target and gates"]
    P --> H["Initialize required providers"]
    H --> Q["Acquire and normalize evidence"]
    Q --> G["Evaluate gate assertions"]
    G --> A["Aggregate decision"]
    A --> R["Redact and publish reports"]
~~~

### 14.1 Load

The loader reads one workspace-local YAML file. Aliases and YAML merge keys are
rejected to avoid surprising policy expansion. Duplicate keys are rejected.

### 14.2 Interpolate

Only the active target and selected phase are interpolated. This allows one reference
file to contain target examples without requiring credentials and variables for
inactive targets.

The supported syntax is ${VARIABLE_NAME}. Interpolation does not evaluate shell
expressions, templates, GitHub expressions, or nested expressions.

### 14.3 Validate

Validation occurs in layers:

1. YAML syntax.
2. Structural schema.
3. Cross-reference integrity.
4. Gate-type-specific assertion schema.
5. Provider capability compatibility.
6. Phase and target applicability.
7. Security restrictions.
8. Environment-variable presence for the selected execution.

All validation errors are returned together where safe, rather than forcing repeated
runs to reveal one error at a time.

### 14.4 Plan

The planner produces an immutable execution graph containing:

- Selected phase and active target.
- Applicable and skipped gates.
- Required provider capabilities.
- Evidence queries and their cache keys.
- Dependencies between evidence and gates.
- Gate timeouts and retry policies.
- Concurrency groups.
- Reporting configuration.

A dry plan can be printed without credentials or network access.

### 14.5 Initialize providers

Only providers required by applicable gates are initialized. Inactive target adapters
and unused evidence providers are not touched.

### 14.6 Acquire evidence

Identical requests within one run are deduplicated. Evidence is cached only in memory
for the current execution. Each item contains acquisition time, source time,
provider, query fingerprint, target, release selector, and provenance.

### 14.7 Evaluate gates

Each gate evaluator receives typed evidence and a GateContext. It returns a complete
GateResult and never throws for an expected policy failure.

### 14.8 Aggregate

The aggregator applies gate enforcement, evidence coverage, and configured outcome
rules. Evaluation order does not affect the decision.

### 14.9 Report

All user-visible values pass through redaction. Reporters consume the immutable
ExecutionResult and cannot mutate it.

## 15. Phase model

## 15.1 Pre-deployment

Pre-deployment has two independent concerns.

### Observable-by-design readiness

This proves that the repository and release artifact contain the prerequisites
needed to observe a deployment:

- Canonical identity.
- Ownership and runbook.
- Dashboard, alerts, alert routing, and SLO.
- Valid gate queries.
- Instrumentation configuration in rendered artifacts.
- Static instrumentation findings as advisory evidence.
- Runtime OTLP contract evidence.
- Collector routing.
- Synthetic verification plan.
- Sufficient post-deployment gate coverage.
- Platform-specific deployment configuration.

### Safe-to-change-now risk

This asks whether current production conditions make a new deployment unsafe:

- Observability backends are reachable.
- Current health and error rate are acceptable.
- SLO is met.
- Error budget remains.
- Burn rate is controlled.
- No critical alert or incident is active.
- Dependencies and telemetry collectors are healthy.
- Runtime has rollout capacity.
- The change window allows deployment.
- No conflicting deployment is active.
- Estimated cardinality and telemetry volume remain within advisory budgets.

Pre-deployment does not predict that the candidate will be healthy. It proves that
the candidate can be observed and that current conditions permit a controlled
attempt.

## 15.2 Post-deployment

Post-deployment proves five things:

1. **Workload identity:** the runtime accepted and is executing the intended release.
2. **Telemetry integrity:** metrics, logs, and traces exist, are fresh, identify the
   candidate, and correlate.
3. **Candidate health:** the release meets direct error, latency, availability,
   throughput, saturation, and stability thresholds.
4. **Regression safety:** the candidate is not materially worse than the baseline.
5. **Reliability and platform health:** SLOs, budget, burn, alerts, dependencies,
   synthetics, and platform-specific status remain acceptable.

A successful deployment command is never sufficient post-deployment evidence.

## 16. Gate lifecycle and states

~~~mermaid
stateDiagram-v2
    [*] --> Planned
    Planned --> Skipped: condition false
    Planned --> Running: applicable
    Running --> Passed: assertions pass
    Running --> Warned: advisory failure
    Running --> Failed: blocking failure
    Running --> Inconclusive: insufficient evidence
    Running --> Error: execution fault
    Passed --> [*]
    Warned --> [*]
    Failed --> [*]
    Inconclusive --> [*]
    Error --> [*]
    Skipped --> [*]
~~~

A gate result contains:

~~~typescript
interface GateResult {
  id: string;
  name: string;
  type: string;
  phase: string;
  enforcement: "blocking" | "advisory";
  status: "passed" | "warned" | "failed" | "inconclusive" | "error" | "skipped";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  assertions: AssertionResult[];
  evidence: EvidenceReference[];
  diagnostics: Diagnostic[];
  remediation?: string;
}
~~~

Expected threshold failures return failed or warned results. Provider protocol faults,
invalid responses, unsupported capabilities, and internal defects return error.

## 17. Assertion model

Assertions are typed rather than implemented as arbitrary expressions. Supported
families include:

- equals and not-equals.
- greater-than, greater-than-or-equal, less-than, and less-than-or-equal.
- allowed and forbidden values.
- presence, absence, and record counts.
- percentage, duration, byte, count, and rate thresholds.
- relative and absolute regression limits.
- all, any, and minimum-passing assertions.
- freshness and clock-skew limits.
- release-identity consistency.
- bounded sets of platform-specific conditions.

The engine validates units before comparison. It cannot compare milliseconds with a
unitless threshold or bytes with percentages.

Every AssertionResult includes expected, observed, unit, outcome, and a concise
explanation.

## 18. Normalized evidence model

### 18.1 Evidence envelope

~~~typescript
interface Evidence<T> {
  kind: string;
  source: {
    provider: string;
    capability: string;
    queryFingerprint?: string;
  };
  target: string;
  releaseId?: string;
  acquiredAt: string;
  observedAt?: string;
  expiresAt?: string;
  provenance?: EvidenceProvenance;
  value: T;
}
~~~

Raw provider responses are not the domain model. An adapter validates and maps them
before returning Evidence.

### 18.2 Runtime snapshot

~~~typescript
interface RuntimeSnapshot {
  resourceExists: boolean;
  provisioningState: "ready" | "progressing" | "failed" | "unknown";
  desiredInstances?: number;
  availableInstances?: number;
  unavailableInstances?: number;
  instances: RuntimeInstance[];
  releaseIdentities: ReleaseObservation[];
  conditions: RuntimeCondition[];
  events: RuntimeEvent[];
  capacity?: CapacitySnapshot;
}
~~~

Common workload gates consume RuntimeSnapshot. Platform gates consume typed extension
evidence such as KubernetesRolloutEvidence or ContainerAppRevisionEvidence.

### 18.3 Telemetry evidence

Telemetry adapters return typed series, records, traces, alerts, and SLO snapshots.
They preserve source timestamps and mapped canonical identity.

Metrics evidence includes sample count and query range. Logs evidence includes record
count and selected structured fields, not unrestricted payloads. Trace evidence
includes trace and span identifiers, service resources, latency, status, and peer
relationships. Alert and SLO evidence includes evaluation timestamps.

### 18.4 File evidence

File evidence contains:

- Workspace-relative canonical path.
- Media type.
- Content digest.
- Size.
- Modification time.
- Declared producer.
- Commit and workflow provenance when required.
- Signature validation result for signed deployment evidence.
- Parsed typed payload.

The engine does not trust a file merely because it exists.

## 19. Canonical identity contract

The identity contract is based on OpenTelemetry resource semantics:

- service.name
- service.namespace
- service.version
- deployment.environment.name
- service.instance.id when available

Metrics backends commonly translate dots to underscores. The configuration therefore
maps canonical attributes to backend label names, while logs and traces preserve
their provider-specific forms.

The engine compares normalized canonical keys, not raw provider keys. For example,
service.version, service_version, and resource.service.version can represent one
canonical field after explicit mapping.

Release identity must be immutable. Values such as latest, main, master, unknown, and
unset are rejected.

## 20. Runtime adapter design

### 20.1 Shared runtime interface

~~~typescript
interface RuntimeAdapter {
  capabilities(): ReadonlySet<RuntimeCapability>;
  getSnapshot(request: RuntimeSnapshotRequest): Promise<Evidence<RuntimeSnapshot>>;
  getPlatformEvidence(
    request: PlatformEvidenceRequest
  ): Promise<Evidence<unknown>>;
}
~~~

The adapter is read-only. It cannot expose mutation methods.

### 20.2 Runtime matrix

| Runtime | Control-plane evidence | Telemetry evidence | Platform-specific checks |
| --- | --- | --- | --- |
| Kubernetes or AKS | Workload, ReplicaSet, Pod, and Event APIs | Prometheus, Loki, Tempo | Rollout, image digest, replicas, restarts, waiting reasons, warning events |
| Azure Container Apps | ARM application, revision, replica, and traffic state | Azure-exported or OTel telemetry | Revision state, image, traffic weights, replica activation and restarts |
| Azure VM | ARM instance view and deployment evidence | Host and process metrics, logs, traces | Provisioning and power state, service health, release marker, host health |
| Linux VM | Signed deployment evidence | node exporter, OTel Collector, logs, traces | systemd service, release marker, host and agent health |
| Windows VM | Signed deployment evidence | windows exporter, OTel Collector, event logs, traces | Windows service, release marker, host and agent health |
| Generic | Signed or trusted evidence only | Configured telemetry providers | Only capabilities supported by supplied evidence |

### 20.3 Kubernetes adapter

The Kubernetes adapter reads only the namespace and resources selected by the active
target. It resolves the workload selector, related ReplicaSets, Pods, and recent
events.

It must:

- Match workload generation and observed generation.
- Distinguish desired, updated, ready, available, and unavailable replicas.
- Resolve running image IDs to immutable digests.
- Calculate restart deltas within the observation window.
- Preserve probe and termination reasons.
- Filter events to the workload and deployment window.
- Respect request deadlines and API pagination.

It must not run kubectl as a subprocess. It uses the Kubernetes API client.

### 20.4 Azure Container Apps adapter

The adapter uses workload identity and Azure Resource Manager read APIs. It resolves
the selected app and candidate revision.

It must expose:

- Application and revision provisioning state.
- Revision running state and active flag.
- Container images and digests where available.
- Desired, running, healthy, and failed replicas.
- Traffic weights and unknown revisions.
- Revision suffix and candidate identity.
- Activation, deactivation, and system events available from configured telemetry.

It never changes traffic weights or activates/deactivates revisions.

### 20.5 VM adapters

VM validation deliberately avoids direct host sessions. It combines:

- Azure instance view when the host is an Azure VM.
- Signed deployment evidence produced by the deployment workflow.
- Release marker metrics.
- Service manager metrics.
- Host capacity metrics.
- Telemetry agent health.
- Application logs and traces.

This model works for Azure and on-prem hosts while keeping the Action outside host
trust boundaries.

A VM target becomes inconclusive or fails according to policy if no trusted evidence
can establish service or release identity.

## 21. Telemetry provider design

### 21.1 Prometheus-compatible metrics

The metrics provider supports instant and range queries. It records query time,
range, step, sample count, warnings, and backend timestamps.

Safeguards:

- Bounded query length and range.
- Configured endpoint only.
- Request timeout and response-size limit.
- No query body in normal logs.
- Numeric handling for NaN, positive infinity, and negative infinity.
- Explicit empty-vector behavior.
- Server warnings preserved as diagnostics.

### 21.2 Loki

The Loki provider performs bounded range queries. It returns structured metadata and
counts required by a gate. Raw log bodies are excluded from reports by default.

The query validator rejects obviously unbounded production queries and unsafe
high-cardinality groupings where detectable.

### 21.3 Tempo

The Tempo provider searches traces using canonical resource attributes and release
identity. It provides trace counts, selected span attributes, latency, status, and
service relationships.

Trace sampling is considered. Absence can be inconclusive when traffic exists but the
configured sampling policy cannot guarantee a trace within the window.

### 21.4 Grafana

The Grafana provider reads:

- Dashboards and panel metadata.
- Alert rules and notification policies.
- Alert states.
- SLO definition and status.
- Error-budget state.
- Burn-rate data.

The provider must distinguish a missing resource, insufficient permission, backend
error, stale evaluation, and valid no-data state.

### 21.5 HTTP provider

The HTTP provider is intentionally constrained:

- HTTPS only.
- Host allowlist.
- No private, loopback, link-local, or metadata endpoints.
- Same-origin redirects.
- Bounded timeout and response size.
- Redacted headers and bodies.
- No user-supplied scripting.

These controls prevent the gate from becoming an SSRF or data-exfiltration tool.

## 22. Evidence provider design

### 22.1 SARIF

SARIF is advisory by default. It communicates static instrumentation findings but
cannot prove that the deployed application emits usable telemetry.

The parser filters supported rule families and maps SARIF levels to policy severity.

### 22.2 OTLP contract capture

An integration test starts the application, exercises representative behavior, and
captures OTLP output into a deterministic evidence file.

The gate validates:

- Required signals.
- Required resource attributes and expected values.
- Trace-log correlation.
- Span error status.
- Route normalization.
- Cardinality controls.
- Sensitive-field exclusions.
- Producer provenance and freshness.

### 22.3 Signed deployment evidence

The deployment workflow writes a signed JSON attestation containing the target,
deployment ID, commit, release ID, image or artifact digest, previous release,
deployment timestamp, and workflow identity.

Post-deployment workload identity checks combine this attestation with runtime and
telemetry evidence.

### 22.4 Synthetic results

The provider accepts JUnit or the product JSON result schema. It identifies required
test cases, pass rate, duration, timestamp, and observed release identity.

## 23. Conditions and applicability

A gate can be:

- Applicable and evaluated.
- Explicitly skipped because its condition is false.
- Failed because its required provider is missing.
- Skipped because an optional provider is unavailable and otherwise is skipped.
- Failed because otherwise is fail.

Conditions are declarative and restricted to known context:

- Runtime type.
- Operating system.
- Provider availability.
- Phase.
- Target attributes.

Conditions cannot execute expressions or inspect secret values.

The planner resolves all conditions before provider initialization.

## 24. Missing data and evidence coverage

Missing data is classified before policy is applied:

| State | Meaning |
| --- | --- |
| No series or records | Provider answered successfully but selected evidence is absent. |
| Stale evidence | Evidence exists but is older than the configured limit. |
| Insufficient samples | Evidence exists but cannot support the requested statistical claim. |
| Provider unavailable | Connection, authentication, permission, or backend failure. |
| Unsupported capability | Selected adapter cannot supply the requested evidence. |
| Invalid evidence | Response or file does not satisfy its typed contract. |

The default behavior is:

- Blocking no-data: fail.
- Advisory no-data: warn.
- Comparison with insufficient samples: inconclusive.
- Synthetic no-data: fail.
- Provider failure required by a blocking gate: error and final failure.
- Explicitly non-applicable gate: skipped.

Evidence coverage is the percentage of applicable gate evidence requirements that
were satisfied with valid and fresh evidence. A phase fails when coverage is below
the configured minimum even if the available gates passed.

## 25. Time semantics

All internal timestamps use UTC and RFC 3339.

The engine distinguishes:

- Workflow start.
- Deployment completion.
- Evidence observation time.
- Evidence acquisition time.
- Candidate warmup.
- Evaluation window.
- Explicit baseline identity and the query window supplied by the policy author.
- Provider evaluation time.

Post-deployment evaluation begins after warmup. It samples until it reaches the
minimum successful samples or the phase timeout.

Clock skew beyond the configured allowance invalidates freshness-sensitive evidence.
A future timestamp cannot silently appear fresh.

## 26. Baseline comparison model

Baseline selection uses `strategy: explicit` and an explicit release ID. Automatic
previous-release discovery, baseline lookback filtering, and automatic incident/deployment
window exclusions are unsupported; configuration requesting them is rejected.

Baseline queries must select the intended healthy interval and use the same identity mapping
and metric definition as the candidate. The engine enforces configured candidate/baseline
sample minima. Instant scalar comparisons contribute one sample; traffic volumes require
independent request-count queries. Low-traffic behavior is `inconclusive`, with
`maximum_extension: 0s`; acquisition success does not prove adequate traffic.

Regression gates apply both absolute and relative limits. This prevents a tiny
baseline value from making a harmless absolute increase appear catastrophic and
prevents a large baseline value from hiding a meaningful increase.

Resource and telemetry-volume comparisons normalize by request rate where configured.

The product does not initially implement automated statistical significance testing.
Deterministic absolute and relative thresholds are easier to explain and validate.

## 27. Decision model

### 27.1 Gate enforcement

| Enforcement | Passing assertion | Failed assertion | Execution error | Insufficient evidence |
| --- | --- | --- | --- | --- |
| Blocking | passed | failed | error | inconclusive or failed by gate policy |
| Advisory | passed | warned | warned with diagnostic | warned |

### 27.2 Aggregate outcome

The final result is:

- **error** when a configuration, security, or engine error prevents trustworthy
  evaluation.
- **fail** when any blocking gate fails or the evidence-coverage minimum is missed.
- **inconclusive** when no blocking gate failed but at least one blocking decision
  cannot be made safely.
- **warn** when all blocking gates pass and at least one advisory gate warns or a
  configured optional gate is skipped.
- **pass** when all applicable blocking gates pass and required evidence coverage is
  met.

The result ordering for severity is error, fail, inconclusive, warn, pass.

Exit codes remain those defined in the YAML policy. The Action maps pass and warn to
successful job conclusions and all blocking outcomes to failure.

### 27.3 Determinism

Gate completion order never affects aggregation. The final list is rendered in
configuration order. Timestamps and durations are metadata and do not change
decisions.

## 28. Pre-deployment gate catalogue

| Gate | Purpose |
| --- | --- |
| readiness.policy | Validate the policy itself, references, identifiers, and security restrictions. |
| readiness.identity | Require stable service, environment, release, and deployment identity. |
| readiness.owner | Ensure ownership and escalation metadata exist. |
| readiness.runbook | Verify that a reachable production runbook exists. |
| readiness.dashboard | Require a service dashboard covering traffic, errors, latency, and saturation. |
| readiness.alert-rules | Require actionable, owned alert rules with severity and runbooks. |
| readiness.alert-routing | Ensure critical alerts route to an active receiver. |
| readiness.slo | Require a queryable SLO aligned with canonical identity. |
| readiness.gate-queries | Compile and shape-check queries before deployment. |
| readiness.instrumentation-configuration | Inspect rendered artifacts for telemetry configuration. |
| readiness.static-instrumentation-analysis | Consume advisory SARIF instrumentation findings. |
| readiness.telemetry-contract-test | Validate runtime-captured OTLP signals and attributes. |
| readiness.telemetry-routing | Validate collector receivers, processors, exporters, queues, retry, and TLS. |
| readiness.synthetic-plan | Require a bounded release-verification journey. |
| readiness.post-gate-coverage | Ensure critical post-deployment failure modes are covered. |
| risk.telemetry-backends | Verify required backends, credentials, and query permissions. |
| risk.current-health | Ensure the existing release is healthy before change. |
| risk.current-error-rate | Bound the current error rate. |
| risk.slo-status | Require the SLO to be met. |
| risk.error-budget | Require sufficient remaining error budget. |
| risk.burn-rate | Reject fast or sustained error-budget burn. |
| risk.active-alerts | Reject firing or erroneous critical alert states. |
| risk.active-incidents | Reject active major incidents when incident evidence is configured. |
| risk.dependencies | Verify required dependencies before change. |
| risk.collector-health | Verify exporter failures, refused data, and queue utilization. |
| risk.capacity-headroom | Ensure the runtime can accommodate rollout demand. |
| risk.change-freeze | Enforce change windows and auditable exceptions. |
| risk.concurrent-deployment | Prevent overlapping deployments for the same service and environment. |
| risk.cardinality-change | Advise on estimated series and attribute growth. |
| risk.telemetry-volume | Advise on signal-volume growth. |
| kubernetes.manifest | Validate immutable image identity and workload security. |
| kubernetes.probes | Validate readiness, liveness, and startup probes. |
| kubernetes.resources | Require resources, replicas, and disruption protection. |
| kubernetes.rollout-strategy | Validate availability-preserving rollout settings. |
| azure-container-apps.configuration | Validate image, revision, scaling, identity, and telemetry settings. |
| azure-container-apps.probes | Validate startup, readiness, and liveness probes. |
| vm.release-identity | Require digest, release marker, service.version, and rollback artifact. |
| vm.service-definition | Validate restart, timeout, shutdown, identity, and agent dependencies. |
| vm.host-capacity | Verify healthy host percentage and resource headroom. |

## 29. Post-deployment gate catalogue

| Gate | Purpose |
| --- | --- |
| workload.provisioned | Confirm that the runtime accepted the intended workload. |
| workload.ready | Confirm normalized instance readiness. |
| workload.release | Match runtime identity with workflow and signed deployment evidence. |
| release.traffic | Require enough candidate traffic for evaluation. |
| telemetry.metrics-presence | Require candidate metrics. |
| telemetry.logs-presence | Require candidate logs. |
| telemetry.traces-presence | Require candidate traces. |
| telemetry.freshness | Bound ingestion delay and clock skew for every signal. |
| telemetry.contract | Validate the live signal, identity, and sensitive-data contract. |
| telemetry.identity-consistency | Compare identity across runtime, telemetry, and deployment evidence. |
| telemetry.trace-log-correlation | Require trace_id and span_id correlation in logs. |
| telemetry.service-graph | Advise when expected service relationships are absent or unknown. |
| telemetry.pipeline-health | Detect export failures, refused data, or collector backpressure. |
| release.error-rate | Bound candidate server errors. |
| release.latency | Bound candidate p95 latency. |
| release.availability | Require candidate request availability. |
| release.throughput | Detect missing or unexpectedly low traffic. |
| release.saturation | Bound process and queue utilization. |
| release.stability | Reject crashes, restarts, OOM termination, and unhealthy instances. |
| regression.error-rate | Compare candidate error rate with the baseline. |
| regression.latency | Compare candidate p95 latency with the baseline. |
| regression.availability | Compare candidate availability with the baseline. |
| regression.resource-usage | Compare per-request CPU and memory demand. |
| regression.dependency-latency | Compare traced dependency latency. |
| regression.telemetry-volume | Advise on metric-series, log-byte, and span growth. |
| reliability.slo-status | Require the observation window to meet the SLO. |
| reliability.error-budget | Bound remaining and release-consumed budget. |
| reliability.burn-rate | Reject fast or sustained post-release burn. |
| reliability.active-alerts | Reject candidate-period critical alerts. |
| dependency.health | Verify dependencies remain healthy. |
| synthetic.result | Require critical release journeys to pass against the intended release. |
| public-endpoint.health | Verify public readiness, TLS, latency, and release identity. |
| custom.business-kpi | Demonstrate an advisory service-specific business metric. |
| kubernetes.rollout | Require completed generation, replica, and availability conditions. |
| kubernetes.image | Require all ready Pods to run the expected image digest. |
| kubernetes.pods | Reject restarts, unhealthy states, image failures, and OOM termination. |
| kubernetes.events | Advise on release-related warning events. |
| azure-container-apps.revision | Require the candidate revision to be provisioned, active, and healthy. |
| azure-container-apps.image | Match revision containers to the expected image. |
| azure-container-apps.traffic | Validate candidate and unknown revision traffic weights. |
| azure-container-apps.replica-health | Reject restarts, unhealthy replicas, and activation failures. |
| azure-vm.provisioning | Verify VM provisioning and power state. |
| windows-vm.service | Verify Windows service state, restarts, and exit code. |
| linux-vm.service | Verify systemd unit state, restarts, and failed units. |
| vm.release-marker | Require every host to report the intended release. |
| vm.host-health | Bound CPU, memory, disk, load, and unavailable hosts. |
| vm.telemetry-agent | Require healthy agents, exports, queues, and freshness. |

## 30. GitHub Action interface

### 30.1 Inputs

The public Action should keep inputs small:

| Input | Required | Meaning |
| --- | --- | --- |
| config | Yes | Workspace-relative path to observability-gate.yml. |
| phase | Yes | pre_deployment or post_deployment. |
| target | No | Overrides execution.active_target. |
| output-directory | No | Overrides the artifact output directory. |
| github-token | No | Token used only for explicitly enabled GitHub reporting. |

Service identity, release identity, target-specific values, endpoints, and credentials
remain environment variables referenced by the policy.

### 30.2 Outputs

The Action exposes:

- decision
- phase
- target_id
- release_id
- baseline_release_id
- passed_count
- warned_count
- failed_count
- skipped_count
- evidence_coverage_percent
- report_path

### 30.3 Permissions

The Action documentation must show least-privilege examples:

- contents: read for repository files.
- id-token: write only when cloud workload identity is used.
- checks: write only when publishing a separate check run.
- pull-requests: write only when PR comments are enabled.

The Action must not assume write permission exists.

### 30.4 Cancellation

The Action binds the GitHub cancellation signal to a root AbortController. Provider
requests, retry waits, and reporters must stop promptly. Partial results may be
written locally but the cancelled run never reports pass.

## 31. CLI interface

The CLI provides:

~~~text
observability-gate validate --config observability-gate.yml
observability-gate plan --config observability-gate.yml --phase pre_deployment
observability-gate run --config observability-gate.yml --phase pre_deployment
observability-gate run --config observability-gate.yml --phase post_deployment
observability-gate explain <gate-id>
observability-gate catalog
~~~

### validate

Performs parsing, schema, reference, gate, and security validation without contacting
providers.

### plan

Prints the active target, applicable and skipped gates, provider capabilities,
environment-variable names, and execution graph. Secret values are never printed.

### run

Executes the selected phase and applies the configured exit code.

### explain

Prints the gate's purpose, required evidence, assertions, result semantics, and
remediation fields.

### catalog

Lists built-in gate types, runtime conditions, evidence capabilities, and assertion
families.

## 32. Provider authentication

Credentials are references to environment-variable names, OIDC/workload identity, or
ambient identity. Secret values never appear in the YAML.

### Azure

The preferred path is GitHub OIDC to an Azure identity with Reader access scoped to
the required resources. The provider does not require a client secret.

### Kubernetes

The provider accepts ambient in-cluster identity or a kubeconfig supplied by the
workflow. Documentation should recommend a namespace-scoped read-only role where
possible.

### Grafana and telemetry backends

Providers accept bearer-token environment references. Separate read-only service
accounts are recommended.

Authentication errors are distinct from empty query results.

## 33. Reporting model

### 33.1 Canonical JSON report

JSON is the authoritative machine-readable report. Other formats are projections.

The report contains:

- Policy and execution metadata.
- Selected phase and target.
- Candidate and baseline identity.
- Final decision.
- Evidence coverage.
- Ordered gate results.
- Assertion results.
- Evidence references and ages.
- Sanitized provider diagnostics.
- Remediation.
- User-configured links.
- Report schema fingerprint.

Raw provider payloads and secrets are excluded.

### 33.2 Markdown summary

The summary prioritizes:

1. Decision and release identity.
2. Failed blocking gates.
3. Inconclusive gates.
4. Advisory warnings.
5. Evidence coverage and freshness.
6. Platform and telemetry details.
7. Links to dashboards, logs, traces, runbook, and deployment.

### 33.3 JUnit

Each gate is a test case. Blocking failures and errors are failures. Advisory warnings
are represented as skipped with explanatory output so test dashboards do not treat
them as release-blocking failures.

### 33.4 SARIF

Policy and artifact findings with file locations become SARIF results. Runtime-only
failures without a source file remain in JSON, Markdown, and GitHub checks.

### 33.5 GitHub annotations

Annotations point to configuration or artifact lines when a stable location exists.
Runtime failures appear in the check summary instead of fabricating a file location.

## 34. Error handling

Errors use a typed hierarchy:

- ConfigurationError
- SecurityPolicyError
- AuthenticationError
- AuthorizationError
- ProviderUnavailableError
- ProviderProtocolError
- EvidenceValidationError
- UnsupportedCapabilityError
- GateEvaluationError
- ReportingError
- InternalError

Every error has:

- Stable machine code.
- Safe user message.
- Retryability.
- Provider and gate context when applicable.
- Redacted technical cause.
- Remediation hint.

Expected policy failures are not exceptions.

A reporter failure cannot change a completed fail into pass. If the canonical JSON
report cannot be written, the execution becomes error because auditability is a core
guarantee.

## 35. Retry, timeout, and concurrency behavior

Retries apply only to transient transport and service errors explicitly configured in
the policy. Authentication, authorization, validation, and most client errors are not
retried.

Backoff includes jitter and respects the phase deadline.

Concurrency is bounded globally and per provider. The evidence coordinator collapses
identical requests so several gates can consume one response.

Each gate receives a child deadline no greater than:

- Its configured timeout.
- Provider timeout plus retry budget.
- Remaining phase timeout.

The phase fails safely when the overall deadline expires.

## 36. Security design

### 36.1 Threats addressed

- Secret exposure in configuration, logs, evidence, or reports.
- SSRF through HTTP probes or configurable provider endpoints.
- Workspace escape through symlinks.
- Malicious or oversized evidence files.
- Command injection.
- Dynamic code loading.
- Credential misuse.
- Overbroad cloud and Kubernetes access.
- Forged deployment evidence.
- Stale or future-dated evidence.
- Denial of service through unbounded queries or response sizes.

### 36.2 Controls

- No shell execution.
- No dynamic plugins.
- HTTPS provider endpoints.
- HTTP probe host allowlist.
- Private, loopback, link-local, and metadata address rejection.
- Workspace-only canonical file paths.
- Out-of-workspace symlink rejection.
- File and response size limits.
- Query length and range limits.
- Header, query-parameter, environment, and payload redaction.
- Signed deployment evidence.
- SHA-256 evidence hashing.
- Freshness and clock-skew validation.
- Read-only provider interfaces and documented least privilege.
- Immutable ExecutionResult before reporting.

### 36.3 Log policy

Normal logs include provider name, operation class, elapsed time, retry count, and
status. They do not include tokens, authorization headers, query strings, response
bodies, raw logs, or evidence-file contents.

A debug mode may reveal query fingerprints and sanitized selectors, but never secrets.

## 37. Configuration contract behavior

The YAML intentionally has no top-level schema-version field.

Compatibility is managed through:

- Strict validation of known fields.
- Stable gate-type names.
- Additive introduction of optional fields.
- Deprecation diagnostics before removal.
- A capability report from validate and plan.
- A generated JSON Schema matching the running binary.
- A configuration fingerprint embedded in reports.

A policy that uses an unsupported field or gate fails validation rather than being
partially interpreted.

This keeps the user-facing contract direct while preserving predictable behavior.

## 38. Extensibility

Initial extensibility is declarative, not executable:

- Add a built-in provider implementing a typed capability.
- Add a built-in gate evaluator registered under a stable type.
- Add a built-in reporter.
- Add target mappings and conditions.
- Configure service-specific metric queries and thresholds.

Third-party dynamic plugins are not loaded. This avoids arbitrary code execution,
dependency conflicts, and an unverifiable Marketplace supply chain.

Contributors extend the source tree through reviewed interfaces and tests.

## 39. Observability of Observability Gate

The product should be observable without sending telemetry externally by default.

Structured internal events include:

- configuration_loaded
- execution_planned
- provider_request_started
- provider_request_completed
- provider_request_retried
- evidence_acquired
- evidence_rejected
- gate_completed
- decision_completed
- report_written

The local JSON event stream is disabled by default and can be enabled for debugging.
Use CLI `run --events <workspace-relative-path>` or Action input `events-path`.
Only whitelisted event metadata is serialized; queries, URLs, credentials, headers,
and provider bodies are excluded. Files have mode 0600 and a two-MiB size limit.

The final report includes duration by provider and gate so users can find slow policy
checks.
Network timing totals include retries; local/runtime resolution totals include cache hits.
These totals describe acquisition work and need not equal phase wall time when calls overlap.

The Action does not phone home and does not emit product analytics unless a future
explicit opt-in design is separately approved.

## 40. Testing strategy

### 40.1 Unit tests

Unit tests cover:

- YAML parsing and duplicate-key rejection.
- Scoped environment interpolation.
- Cross-reference validation.
- Conditions and applicability.
- Every assertion operator and unit conversion.
- Missing-data classification.
- Evidence freshness and clock skew.
- Decision aggregation.
- Redaction.
- Query fingerprinting.
- Baseline comparison math.
- Every gate evaluator using typed fixtures.

### 40.2 Schema tests

Every example policy must validate against the generated schema. Invalid fixtures
cover unknown fields, bad gate types, malformed thresholds, missing references,
inline secrets, unsafe paths, and unsupported capabilities.

### 40.3 Provider contract tests

Each provider is tested against a controlled fake server that returns:

- Successful responses.
- Empty results.
- Stale results.
- Partial responses.
- Malformed payloads.
- Pagination.
- Rate limiting.
- Authentication and authorization failures.
- Timeouts.
- Retryable server errors.
- Oversized responses.

Contract tests assert normalized evidence rather than raw provider objects.

### 40.4 Golden report tests

Stable ExecutionResult fixtures render to JSON, Markdown, JUnit, and SARIF. Golden
tests prevent accidental loss of evidence, remediation, ordering, or redaction.

Variable timestamps and durations are normalized before comparison.

### 40.5 Integration tests

Integration tests use ephemeral services where practical:

- Prometheus-compatible API.
- Loki-compatible API.
- Tempo-compatible API.
- Grafana API fake with realistic resources.
- Kubernetes kind cluster.
- Local HTTP probe service.
- Signed evidence fixture producer and verifier.

Azure Resource Manager tests primarily use recorded, sanitized responses and fake
HTTP transports. A small separately controlled live test validates identity and API
compatibility.

### 40.6 End-to-end tests

A sample service emits metrics, logs, and traces. The pipeline:

1. Builds the service.
2. Produces OTLP contract evidence.
3. Runs pre_deployment.
4. Deploys to a disposable Kubernetes environment.
5. Generates traffic and failures.
6. Runs post_deployment for passing and failing scenarios.
7. Verifies exit code, Action outputs, annotations, and report artifacts.

Platform-specific end-to-end suites cover Container Apps and VM evidence where
environment cost and availability allow.

### 40.7 Security tests

Security tests cover:

- SSRF address forms and DNS rebinding defenses.
- Path traversal and symlink escape.
- Malicious YAML.
- Secret-shaped values in diagnostics.
- Oversized and compressed evidence.
- Forged signatures and provenance.
- Future timestamps.
- Query and header redaction.
- Cancellation during provider requests.
- Attempted command or plugin configuration.

### 40.8 Mutation and property tests

Decision aggregation, threshold comparison, unit conversion, interpolation, and
redaction are suitable for property-based tests. Mutation testing is valuable for the
decision engine because a flipped comparison operator could incorrectly approve a
release.

## 41. Performance expectations

The engine is network-bound. The architecture optimizes provider round trips rather
than local CPU.

Expected characteristics:

- Validation completes without network access.
- Plan completes without provider credentials.
- Identical evidence requests execute once per run.
- Independent gates run concurrently within configured bounds.
- Report generation is linear in gate and assertion count.
- Memory remains bounded by response and report size limits.
- Phase deadlines always dominate retry behavior.

The design target is for gate overhead to be small relative to the configured
observation window. A post-deployment policy waiting ten minutes for samples should
not add several additional minutes of avoidable sequential API calls.

## 42. User experience requirements

Failures must be readable without opening raw artifacts.

A failed gate summary should resemble:

~~~text
FAIL release.latency — Candidate p95 latency is acceptable

Observed: 0.94 seconds
Required: <= 0.75 seconds
Window: 10 minutes after 2-minute warmup
Samples: 1,284 candidate requests
Evidence age: 18 seconds
Release: 8a6d4ef
Target: aks-checkout

Remediation: Inspect slow traces, downstream calls, and saturation.
Links: traces | dashboard | deployment
~~~

A user should never need to infer whether a failure came from unhealthy evidence,
missing evidence, a provider permission issue, or a configuration defect.

## 43. Documentation set

The repository should contain:

- README with product promise and minimal example.
- Configuration reference.
- Gate catalogue generated from the registry.
- Provider setup and least-privilege permissions.
- Runtime guides for Kubernetes, Container Apps, Azure VMs, Linux VMs, and Windows
  VMs.
- Telemetry identity contract.
- OTLP contract-test guide.
- Signed deployment-evidence schema.
- GitHub workflow examples for both phases.
- CLI reference.
- Troubleshooting guide organized by error code.
- Security model.
- Contributing guide for gates, providers, and reporters.
- Architecture decision records for major interface choices.

Generated documentation must derive gate fields and assertion schemas from source
metadata to prevent drift.

## 44. Acceptance criteria for the product design

The implementation conforms to this design when all of the following are true:

1. The exhaustive reference policy parses structurally; workload-specific acquisition queries,
   credentials, artifacts, and identities are supplied before execution. `examples/offline.yml`
   validates and runs without customization; the Helm workflow example documents every prerequisite.
2. The same core engine runs through both the Action and CLI.
3. Both phases execute independently from the same file.
4. Every gate ID in the reference policy resolves to a registered evaluator.
5. Inactive targets do not require their environment variables or credentials.
6. Common workload gates operate on normalized evidence.
7. Platform-specific gates preserve Kubernetes, Container Apps, and VM semantics.
8. Static SARIF remains advisory while OTLP contract evidence can be blocking.
9. Candidate and baseline identity are explicit in comparison results.
10. Missing, stale, insufficient, invalid, and unavailable evidence are distinguishable.
11. Blocking and advisory behavior matches the configured decision model.
12. Evidence coverage can block an otherwise passing phase.
13. Provider clients expose no mutation operations.
14. The product opens no SSH or WinRM session.
15. Configuration cannot execute a shell or load dynamic code.
16. Reports exclude secrets and raw sensitive payloads.
17. JSON, Markdown, JUnit, SARIF, Action outputs, and exit codes agree.
18. Cancellation stops outstanding work and never returns pass.
19. Tests cover passing, failing, missing-data, provider-error, and cancellation paths.
20. The product operates without a hosted backend.

## 45. Design decisions fixed by this specification

- One YAML policy is evaluated in two explicitly selected phases.
- The YAML is the public policy contract.
- The Action and CLI share one TypeScript engine.
- The product is backend-free and read-only.
- Runtime and telemetry acquisition are separated from gate evaluation.
- Common gates consume normalized evidence.
- Platform-specific gates remain available.
- Static source findings support but do not replace runtime proof.
- Missing data is explicit and safe by default.
- Reports are evidence-rich and deterministic.
- Dynamic plugins and arbitrary commands are forbidden.
- VM support uses telemetry and trusted deployment evidence, not remote login.
- Configuration does not require a top-level version field.
- Mutation and remediation remain the responsibility of the user's deployment workflow.

## 46. Deferred capabilities

The following are excluded from the first implementation because they expand the
trust or operational boundary:

- Automatic rollback.
- Traffic shifting.
- Hosted policy management.
- Long-term release history.
- Machine-learned anomaly thresholds.
- Arbitrary user code.
- Third-party dynamic plugins.
- Automatic instrumentation.
- Automatic dashboard or alert creation.
- Direct incident-system mutation.
- Release approval user interface.

They can be considered later only through separate designs. None is required to
execute the reference YAML.

