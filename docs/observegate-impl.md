# Observability Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a backend-free, read-only GitHub Marketplace Action and CLI that execute the approved pre-deployment and post-deployment observability policy.

**Architecture:** A strict TypeScript core loads the YAML contract, creates an immutable execution plan, acquires typed evidence through read-only adapters, evaluates registered gates, aggregates a deterministic decision, and renders reports. The GitHub Action and CLI are thin entry points over the same application service; platform-specific adapters normalize shared facts without discarding Kubernetes, Azure Container Apps, or VM semantics.

**Tech Stack:** Node.js 24 for the JavaScript Action, TypeScript in strict ESM mode, npm workspaces, Vitest, Zod, yaml, built-in fetch with guarded transport, @actions/core, @actions/github, @kubernetes/client-node, @azure/identity, @azure/arm-appcontainers, @azure/arm-compute, and Rollup.

**Spec:** ../../../observability-gate-design-specification.md

**Reference policy:** ../../../observability-gate.yml

## Global Constraints

- One YAML policy is evaluated in the explicitly selected pre_deployment or post_deployment phase.
- The YAML is the public policy contract and has no top-level schema-version field.
- The GitHub Action and CLI must call the same application service.
- The product has no hosted backend and persists no long-term release state.
- Every provider and runtime interface is read-only.
- The engine must never deploy, roll back, shift traffic, scale, restart, mutate alerts or dashboards, create silences, use SSH, or use WinRM.
- Runtime and telemetry acquisition remain separate from gate evaluation.
- Common gates consume normalized evidence; platform-specific gates preserve platform semantics.
- Static SARIF findings remain advisory; runtime OTLP contract and live telemetry checks can block.
- Missing, stale, insufficient, invalid, unavailable, and unsupported evidence remain distinct states.
- Reports must be deterministic, evidence-rich, and redacted.
- Arbitrary shell execution and dynamic plugins are forbidden.
- All internal timestamps use UTC and RFC 3339.
- The Action metadata uses the current GitHub JavaScript runtime, node24.
- The repository uses strict ESM because the current Kubernetes JavaScript client is ESM.
- Dependencies are installed with --save-exact and committed through package-lock.json.
- Each task follows red-green-refactor, passes type checking, and ends with a focused commit.
- No task may weaken a failing test to make implementation pass.

## Review Focus

1. Duplicate YAML keys, aliases, merge keys, and workspace-escaping symlinks must fail before provider initialization; Task 3 and Task 10 pin these cases.
2. A provider returning HTTP 200 with empty, malformed, stale, future-dated, or oversized data must produce the correct evidence state rather than pass; Tasks 6 and 10–14 pin these cases.
3. Missing baselines, low candidate traffic, and insufficient samples must produce inconclusive comparison results instead of zero-valued passes; Tasks 11 and 21 pin these cases.
4. Cancellation during retry, observation sampling, or report publication must stop promptly and must never return pass; Tasks 10, 26, and 27 pin these cases.
5. Runtime, deployment-attestation, and telemetry release identities that disagree must fail even when each source is individually healthy; Tasks 20 and 29 pin this case.

---

## Delivery slices

The product is large enough to contain several subsystems. This master plan keeps them
in one dependency-ordered document while preserving independently testable slices:

1. Foundation and configuration.
2. Domain, evidence, assertions, and decisions.
3. Provider and runtime adapters.
4. Pre-deployment gates.
5. Post-deployment gates.
6. Reporting, CLI, and GitHub Action.
7. Documentation, end-to-end validation, security, and packaging.

A slice is complete only when its tests pass without relying on a later slice.

## Planned file map

| Path | Responsibility |
| --- | --- |
| package.json | Workspace scripts and pinned toolchain dependencies. |
| tsconfig.base.json | Strict shared TypeScript settings. |
| action.yml | Marketplace Action inputs, outputs, and node24 entry point. |
| packages/core | Domain types, errors, execution, evidence, decisions, and application service. |
| packages/config | YAML parsing, schema validation, interpolation, reference checks, and planning. |
| packages/providers | Guarded HTTP, telemetry, Grafana, Kubernetes, Azure, evidence-file, and HTTP-probe adapters. |
| packages/gates | Gate registry, generic evaluators, phase gates, and platform gates. |
| packages/reporters | JSON, Markdown, JUnit, SARIF, and GitHub output projections. |
| packages/cli | validate, plan, run, explain, and catalog commands. |
| packages/action | GitHub Actions input/output and cancellation adapter. |
| fixtures | Deterministic policies, provider responses, evidence, certificates, and signatures. |
| tests/contract | Provider contract and schema-compatibility tests. |
| tests/integration | Fake-service and kind-cluster integration tests. |
| tests/end-to-end | Complete pre/post workflow scenarios. |
| docs | Generated configuration, gate, provider, runtime, security, and troubleshooting documentation. |

---

### Task 1: Bootstrap the strict TypeScript workspace

**Files:**
- Create: package.json
- Create: package-lock.json
- Create: tsconfig.base.json
- Create: eslint.config.js
- Create: .prettierrc.json
- Create: .gitignore
- Create: packages/core/package.json
- Create: packages/core/tsconfig.json
- Create: packages/core/src/index.ts
- Create: packages/core/test/smoke.test.ts
- Create: .github/workflows/ci.yml

**Interfaces:**
- Consumes: an empty repository plus the approved spec and reference policy.
- Produces: npm scripts named build, test, test:coverage, typecheck, lint, format:check, and ci; an importable @observability-gate/core workspace.

- [ ] **Step 1: Create the root workspace manifest**

~~~json
{
  "name": "observability-gate",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc -b",
    "lint": "eslint .",
    "format:check": "prettier --check .",
    "ci": "npm run format:check && npm run lint && npm run typecheck && npm run test:coverage && npm run build"
  }
}
~~~

- [ ] **Step 2: Install and pin the foundation toolchain**

Run:

~~~bash
npm install --save-dev --save-exact typescript vitest @vitest/coverage-v8 eslint @eslint/js typescript-eslint prettier rollup @rollup/plugin-node-resolve @rollup/plugin-commonjs
~~~

Expected: package-lock.json is created and every direct dependency in package.json has an exact version.

- [ ] **Step 3: Add strict compiler settings**

~~~json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "declaration": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": true
  }
}
~~~

- [ ] **Step 4: Write the failing workspace smoke test**

~~~typescript
import { describe, expect, it } from "vitest";
import { productName } from "../src/index.js";

describe("core workspace", () => {
  it("exports the product identity", () => {
    expect(productName).toBe("Observability Gate");
  });
});
~~~

- [ ] **Step 5: Run the smoke test and verify failure**

Run: npm test -- packages/core/test/smoke.test.ts

Expected: FAIL because packages/core/src/index.ts does not export productName.

- [ ] **Step 6: Add the minimal core export**

~~~typescript
export const productName = "Observability Gate";
~~~

- [ ] **Step 7: Add CI for supported pull requests and main**

The workflow must run npm ci followed by npm run ci on ubuntu-latest and use actions/checkout and actions/setup-node pinned to full commit SHAs. Set the setup-node input node-version to 24 and cache to npm.

- [ ] **Step 8: Verify the foundation**

Run:

~~~bash
npm run ci
~~~

Expected: all commands pass and coverage includes the smoke test.

- [ ] **Step 9: Commit**

~~~bash
git add package.json package-lock.json tsconfig.base.json eslint.config.js .prettierrc.json .gitignore packages/core .github/workflows/ci.yml
git commit -m "build: bootstrap strict TypeScript workspace"
~~~

---

### Task 2: Define immutable domain types and typed errors

**Files:**
- Create: packages/core/src/domain/execution.ts
- Create: packages/core/src/domain/gates.ts
- Create: packages/core/src/domain/identity.ts
- Create: packages/core/src/errors/codes.ts
- Create: packages/core/src/errors/gate-error.ts
- Modify: packages/core/src/index.ts
- Test: packages/core/test/domain/gate-result.test.ts
- Test: packages/core/test/errors/gate-error.test.ts

**Interfaces:**
- Consumes: no application interfaces.
- Produces: ExecutionRequest, ExecutionResult, GateDefinition, GateResult, AssertionResult, Diagnostic, GateError, ErrorCode, Decision, GateStatus, and Enforcement.

- [ ] **Step 1: Write failing domain tests**

~~~typescript
import { describe, expect, it } from "vitest";
import { createGateResult } from "../../src/domain/gates.js";

describe("createGateResult", () => {
  it("freezes the gate result and nested arrays", () => {
    const result = createGateResult({
      id: "release.error-rate",
      name: "Candidate error rate",
      type: "metric.threshold",
      phase: "post_deployment",
      enforcement: "blocking",
      status: "passed",
      startedAt: "2026-09-24T00:00:00.000Z",
      completedAt: "2026-09-24T00:00:01.000Z",
      durationMs: 1000,
      assertions: [],
      evidence: [],
      diagnostics: []
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assertions)).toBe(true);
  });
});
~~~

- [ ] **Step 2: Run the tests and verify failure**

Run: npm test -- packages/core/test/domain/gate-result.test.ts

Expected: FAIL because createGateResult is not defined.

- [ ] **Step 3: Define the result vocabulary**

~~~typescript
export type Phase = "pre_deployment" | "post_deployment";
export type Decision = "pass" | "warn" | "fail" | "inconclusive" | "error";
export type GateStatus =
  | "passed"
  | "warned"
  | "failed"
  | "inconclusive"
  | "error"
  | "skipped";
export type Enforcement = "blocking" | "advisory";

export interface AssertionResult {
  readonly assertion: string;
  readonly status: Exclude<GateStatus, "skipped">;
  readonly expected?: unknown;
  readonly observed?: unknown;
  readonly unit?: string;
  readonly message: string;
}

export interface EvidenceReference {
  readonly id: string;
  readonly kind: string;
  readonly provider: string;
  readonly observedAt?: string;
  readonly acquiredAt: string;
  readonly ageMs?: number;
  readonly fingerprint: string;
}

export interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface GateResult {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly phase: Phase;
  readonly enforcement: Enforcement;
  readonly status: GateStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly assertions: readonly AssertionResult[];
  readonly evidence: readonly EvidenceReference[];
  readonly diagnostics: readonly Diagnostic[];
  readonly remediation?: string;
}
~~~

- [ ] **Step 4: Implement deep freezing for result-owned collections**

~~~typescript
export function createGateResult(input: GateResult): GateResult {
  return Object.freeze({
    ...input,
    assertions: Object.freeze([...input.assertions]),
    evidence: Object.freeze([...input.evidence]),
    diagnostics: Object.freeze([...input.diagnostics])
  });
}
~~~

- [ ] **Step 5: Define stable error codes and GateError**

Include these exact codes: CONFIG_SYNTAX, CONFIG_SCHEMA, CONFIG_REFERENCE, SECURITY_POLICY, AUTHENTICATION, AUTHORIZATION, PROVIDER_UNAVAILABLE, PROVIDER_PROTOCOL, EVIDENCE_INVALID, CAPABILITY_UNSUPPORTED, GATE_EVALUATION, REPORTING, CANCELLED, INTERNAL.

GateError must expose code, safeMessage, retryable, provider, gateId, and cause without serializing the cause by default.

- [ ] **Step 6: Test safe serialization**

The test must construct GateError with a cause containing bearer-token text and assert JSON.stringify(error.toDiagnostic()) excludes the cause and token.

- [ ] **Step 7: Run domain tests and type checking**

Run:

~~~bash
npm test -- packages/core/test/domain packages/core/test/errors
npm run typecheck
~~~

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add packages/core
git commit -m "feat(core): define immutable execution domain"
~~~

---

### Task 3: Parse and structurally validate the YAML contract

**Files:**
- Create: packages/config/package.json
- Create: packages/config/tsconfig.json
- Create: packages/config/src/parse-policy.ts
- Create: packages/config/src/schema/policy.ts
- Create: packages/config/src/schema/common.ts
- Create: packages/config/src/schema/gate-envelope.ts
- Create: packages/config/src/index.ts
- Create: packages/config/test/parse-policy.test.ts
- Create: fixtures/configs/minimal-valid.yml
- Create: fixtures/configs/duplicate-key.yml
- Create: fixtures/configs/alias.yml
- Create: fixtures/configs/unknown-field.yml

**Interfaces:**
- Consumes: YAML text or a workspace-local file path.
- Produces: parsePolicy(text: string): RawPolicy and loadPolicy(path: string, workspace: string): Promise<RawPolicy>.

- [ ] **Step 1: Install parsing dependencies**

Run:

~~~bash
npm install --workspace packages/config --save-exact yaml zod
npm install --workspace packages/config --save-exact @observability-gate/core
~~~

- [ ] **Step 2: Write failing parser tests**

Tests must assert:

- minimal-valid.yml parses.
- duplicate-key.yml throws CONFIG_SYNTAX.
- alias.yml and YAML merge keys throw SECURITY_POLICY.
- unknown-field.yml throws CONFIG_SCHEMA.
- a top-level version or schema_version field throws CONFIG_SCHEMA.
- a policy lacking either phase throws CONFIG_SCHEMA.

- [ ] **Step 3: Run the parser tests and verify failure**

Run: npm test -- packages/config/test/parse-policy.test.ts

Expected: FAIL because parsePolicy and loadPolicy do not exist.

- [ ] **Step 4: Implement hardened YAML parsing**

~~~typescript
import { parseDocument } from "yaml";
import { GateError } from "@observability-gate/core";

export function parseYaml(text: string): unknown {
  const document = parseDocument(text, {
    uniqueKeys: true,
    merge: false,
    maxAliasCount: 0
  });

  if (document.errors.length > 0) {
    throw new GateError({
      code: "CONFIG_SYNTAX",
      safeMessage: document.errors.map((error) => error.message).join("; "),
      retryable: false
    });
  }

  if (document.anchors.size > 0) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "YAML aliases and anchors are not allowed",
      retryable: false
    });
  }

  return document.toJS({ maxAliasCount: 0 });
}
~~~

- [ ] **Step 5: Implement strict Zod envelopes**

Define strict schemas for metadata, execution, identity, release, observation, decision, targets, providers, gate_defaults, gates, reporting, security, and limits.

GateEnvelopeSchema must require id, name, type and allow only the common gate keys plus a gate-specific payload captured under a validated discriminated schema registry. Do not use z.any. Use z.unknown only at the parser boundary.

- [ ] **Step 6: Implement workspace path protection in loadPolicy**

Resolve both workspace and requested path with realpath, require the file to be inside the workspace, reject an escaping symlink, require a regular file, and cap input at 2 MiB.

- [ ] **Step 7: Re-run parser tests**

Run:

~~~bash
npm test -- packages/config/test/parse-policy.test.ts
npm run typecheck
~~~

Expected: PASS, including duplicate key, alias, unknown field, and symlink cases.

- [ ] **Step 8: Commit**

~~~bash
git add packages/config fixtures/configs package.json package-lock.json
git commit -m "feat(config): parse and validate policy YAML"
~~~

---

### Task 4: Implement scoped environment interpolation

**Files:**
- Create: packages/config/src/interpolation/expand.ts
- Create: packages/config/src/interpolation/select-scope.ts
- Modify: packages/config/src/index.ts
- Test: packages/config/test/interpolation.test.ts

**Interfaces:**
- Consumes: RawPolicy, selected phase, environment map, and optional target override.
- Produces: interpolatePolicy(policy, request): InterpolatedPolicy without mutating RawPolicy.

- [ ] **Step 1: Write failing interpolation tests**

Tests must cover:

- ${SERVICE_NAME} expands in identity.
- ${TARGET_ID} selects the active target.
- Variables in inactive target definitions are not required.
- Variables in the unselected phase are not required.
- missing selected variables throw CONFIG_SCHEMA with the variable name, not its value.
- nested syntax, $(), GitHub expressions, defaults, and escaped shell syntax are not evaluated.
- input objects remain unchanged.

- [ ] **Step 2: Implement the only supported substitution**

~~~typescript
const variablePattern = /\$\{([A-Z][A-Z0-9_]*)\}/g;

export function expandString(
  value: string,
  environment: Readonly<Record<string, string | undefined>>
): string {
  return value.replace(variablePattern, (_match, name: string) => {
    const replacement = environment[name];
    if (replacement === undefined || replacement.length === 0) {
      throw new GateError({
        code: "CONFIG_SCHEMA",
        safeMessage: "Missing required environment variable: " + name,
        retryable: false
      });
    }
    return replacement;
  });
}
~~~

- [ ] **Step 3: Implement scope selection**

First resolve active target from request.targetOverride or execution.active_target. Copy only shared sections, the active target definition, and the selected phase gates into an interpolation view. Preserve the full policy separately for validate and catalog operations.

- [ ] **Step 4: Run interpolation tests**

Run: npm test -- packages/config/test/interpolation.test.ts

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/config
git commit -m "feat(config): add scoped environment interpolation"
~~~

---

### Task 5: Validate references and create an immutable execution plan

**Files:**
- Create: packages/config/src/planning/conditions.ts
- Create: packages/config/src/planning/references.ts
- Create: packages/config/src/planning/create-plan.ts
- Create: packages/config/src/planning/types.ts
- Modify: packages/config/src/index.ts
- Test: packages/config/test/create-plan.test.ts
- Create: fixtures/configs/conditions.yml
- Create: fixtures/configs/broken-reference.yml

**Interfaces:**
- Consumes: InterpolatedPolicy, phase, active target, and GateCatalog metadata.
- Produces: createExecutionPlan(input): ExecutionPlan with ordered planned gates and provider requirements.

- [ ] **Step 1: Define planning types**

~~~typescript
export interface ProviderRequirement {
  readonly provider: string;
  readonly capability: string;
  readonly required: boolean;
}

export interface PlannedGate {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly enforcement: "blocking" | "advisory";
  readonly applicability: "applicable" | "skipped";
  readonly skipReason?: string;
  readonly timeoutMs: number;
  readonly providerRequirements: readonly ProviderRequirement[];
  readonly definition: Readonly<Record<string, unknown>>;
}

export interface ExecutionPlan {
  readonly phase: "pre_deployment" | "post_deployment";
  readonly targetId: string;
  readonly runtimeType: string;
  readonly gates: readonly PlannedGate[];
  readonly requiredProviders: readonly ProviderRequirement[];
  readonly deadlineMs: number;
}
~~~

- [ ] **Step 2: Write failing planner tests**

Tests must assert:

- configuration order is preserved.
- kubernetes gates are skipped for an Azure Container Apps target.
- windows gates are skipped for Linux.
- optional provider with otherwise skipped produces a skipped plan entry.
- unknown target, provider, gate type, output reference, or target property fails CONFIG_REFERENCE.
- duplicate gate IDs fail CONFIG_REFERENCE.
- at least one blocking post-deployment gate is required.
- provider requirements are deduplicated.
- the returned plan and gate arrays are frozen.

- [ ] **Step 3: Implement condition evaluation**

Support only phase, runtime_type, operating_system, and provider_available. Reject any other condition key. An array value means membership; a scalar means equality.

- [ ] **Step 4: Implement cross-reference validation**

Validate active target, runtime provider, telemetry and evidence providers, gate type, source provider, configured file paths, and report links. Environment variable names are validated syntactically but their values remain unavailable to diagnostics.

- [ ] **Step 5: Implement plan creation**

Merge gate_defaults with each gate, evaluate applicability, look up provider requirements from GateCatalog, compute timeouts in milliseconds, deduplicate provider requirements, and deep-freeze the plan.

- [ ] **Step 6: Run planner tests**

Run:

~~~bash
npm test -- packages/config/test/create-plan.test.ts
npm run typecheck
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add packages/config fixtures/configs
git commit -m "feat(config): build immutable execution plans"
~~~

---

### Task 6: Implement evidence envelopes, freshness, and run-local caching

**Files:**
- Create: packages/core/src/evidence/types.ts
- Create: packages/core/src/evidence/states.ts
- Create: packages/core/src/evidence/freshness.ts
- Create: packages/core/src/evidence/store.ts
- Create: packages/core/src/evidence/fingerprint.ts
- Modify: packages/core/src/index.ts
- Test: packages/core/test/evidence/store.test.ts
- Test: packages/core/test/evidence/freshness.test.ts

**Interfaces:**
- Consumes: EvidenceRequest<T>, provider loader function, current clock, and freshness policy.
- Produces: Evidence<T>, EvidenceState, EvidenceStore.getOrLoad<T>(), and stable request fingerprints.

- [ ] **Step 1: Define evidence types**

~~~typescript
export type EvidenceState =
  | "valid"
  | "missing"
  | "stale"
  | "insufficient"
  | "invalid"
  | "unavailable"
  | "unsupported";

export interface Evidence<T> {
  readonly id: string;
  readonly kind: string;
  readonly state: EvidenceState;
  readonly source: {
    readonly provider: string;
    readonly capability: string;
    readonly queryFingerprint?: string;
  };
  readonly target: string;
  readonly releaseId?: string;
  readonly acquiredAt: string;
  readonly observedAt?: string;
  readonly expiresAt?: string;
  readonly value?: T;
  readonly diagnostics: readonly Diagnostic[];
}
~~~

- [ ] **Step 2: Write failing store tests**

Tests must verify:

- two concurrent identical requests invoke the loader once.
- a rejected load is represented as unavailable and does not leak its raw cause.
- evidence is cached only for the store lifetime.
- object-key order does not change the SHA-256 fingerprint.
- provider, capability, target, release, range, and normalized query all affect the fingerprint.
- stale, future-dated, invalid, empty, and insufficient evidence remain distinct.
- future timestamps beyond 30 seconds are invalid.

- [ ] **Step 3: Implement canonical fingerprinting**

Recursively sort object keys, preserve array order, encode UTF-8 JSON, and return a SHA-256 hex digest. Never include credential values.

- [ ] **Step 4: Implement EvidenceStore**

Use Map<string, Promise<Evidence<unknown>>> so concurrent callers share the same in-flight acquisition. Remove a rejected internal promise only after converting it to unavailable evidence.

- [ ] **Step 5: Implement freshness classification**

Accept observedAt, acquiredAt, maximumAgeMs, maximumFutureSkewMs, sampleCount, and minimumSamples. Return invalid for future skew, stale for old observations, insufficient for sample shortage, and valid otherwise.

- [ ] **Step 6: Run evidence tests**

Run: npm test -- packages/core/test/evidence

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add packages/core
git commit -m "feat(core): normalize and cache run evidence"
~~~

---

### Task 7: Implement the typed assertion engine

**Files:**
- Create: packages/core/src/assertions/types.ts
- Create: packages/core/src/assertions/evaluate.ts
- Create: packages/core/src/assertions/units.ts
- Modify: packages/core/src/index.ts
- Test: packages/core/test/assertions/evaluate.test.ts
- Test: packages/core/test/assertions/units.test.ts

**Interfaces:**
- Consumes: AssertionDefinition and typed observed value.
- Produces: evaluateAssertion(definition, observed): AssertionResult.

- [ ] **Step 1: Define the assertion union**

Support equals, not_equals, greater_than, greater_than_or_equal, less_than, less_than_or_equal, allowed_values, forbidden_values, present, absent, count, freshness, all, any, and minimum_passing.

Numeric assertions carry an optional unit from percent, ratio, count, seconds, milliseconds, bytes, bytes_per_second, requests_per_second, or events_per_second.

- [ ] **Step 2: Write failing assertion tests**

Use table tests for boundaries and assert:

- less_than rejects equality.
- less_than_or_equal accepts equality.
- NaN and infinities produce invalid evidence diagnostics.
- 750 milliseconds correctly compares with 0.75 seconds.
- percent and ratio are not silently mixed.
- empty arrays differ from absent values.
- all and any preserve child assertion results.
- minimum_passing reports the required and observed pass count.

- [ ] **Step 3: Implement exact unit normalization**

Normalize durations to milliseconds, byte values to bytes, percentages to percentage points, and ratios to unitless decimals. Reject incompatible families with EVIDENCE_INVALID.

- [ ] **Step 4: Implement evaluateAssertion as an exhaustive switch**

Use a never assertion in the default branch so a newly added assertion type fails compilation until implemented.

- [ ] **Step 5: Run assertion tests and coverage**

Run:

~~~bash
npm test -- packages/core/test/assertions
npm run test:coverage -- packages/core/test/assertions
~~~

Expected: PASS with every assertion branch covered.

- [ ] **Step 6: Commit**

~~~bash
git add packages/core
git commit -m "feat(core): add typed assertion engine"
~~~

---

### Task 8: Build the gate catalogue, registry, and executor

**Files:**
- Create: packages/gates/package.json
- Create: packages/gates/tsconfig.json
- Create: packages/gates/src/catalog/types.ts
- Create: packages/gates/src/catalog/registry.ts
- Create: packages/gates/src/execution/context.ts
- Create: packages/gates/src/execution/execute-gate.ts
- Create: packages/gates/src/index.ts
- Create: packages/gates/test/registry.test.ts
- Create: packages/gates/test/execute-gate.test.ts

**Interfaces:**
- Consumes: PlannedGate, GateContext, EvidenceStore, assertion engine, and AbortSignal.
- Produces: GateCatalog.register(), GateCatalog.require(), executeGate(): Promise<GateResult>.

- [ ] **Step 1: Define the evaluator interface**

~~~typescript
export interface GateTypeDefinition<TDefinition, TEvidence> {
  readonly type: string;
  readonly description: string;
  readonly supportedPhases: readonly Phase[];
  readonly providerRequirements: readonly ProviderRequirement[];
  readonly parseDefinition: (input: unknown) => TDefinition;
  readonly acquire: (
    definition: TDefinition,
    context: GateContext
  ) => Promise<readonly Evidence<TEvidence>[]>;
  readonly evaluate: (
    definition: TDefinition,
    evidence: readonly Evidence<TEvidence>[],
    context: GateContext
  ) => readonly AssertionResult[];
}
~~~

- [ ] **Step 2: Write failing registry tests**

Tests must reject duplicate type registration, unknown type lookup, unsupported phase use, and a definition that fails its gate-specific parser.

- [ ] **Step 3: Implement the registry**

Use Map<string, GateTypeDefinition<unknown, unknown>> internally. Freeze definitions during registration. Expose sorted catalogue metadata without exposing evaluator functions.

- [ ] **Step 4: Write failing executor tests**

Tests must cover passed, failed, warned, skipped, inconclusive, error, timeout, and cancellation results. A thrown GateError with AUTHORIZATION becomes error. A threshold miss becomes failed or warned based on enforcement.

- [ ] **Step 5: Implement executeGate**

Record a start timestamp, derive a timeout AbortSignal, acquire evidence, apply missing-evidence policy, evaluate assertions, calculate status, create an immutable GateResult, and always clear the timeout.

- [ ] **Step 6: Run gate-engine tests**

Run: npm test -- packages/gates/test/registry.test.ts packages/gates/test/execute-gate.test.ts

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add packages/gates package.json package-lock.json
git commit -m "feat(gates): add catalogue and gate executor"
~~~

---

### Task 9: Implement deterministic decision aggregation

**Files:**
- Create: packages/core/src/decisions/aggregate.ts
- Create: packages/core/src/decisions/coverage.ts
- Modify: packages/core/src/index.ts
- Test: packages/core/test/decisions/aggregate.test.ts

**Interfaces:**
- Consumes: ordered GateResult list and decision policy.
- Produces: aggregateDecision(input): DecisionSummary.

- [ ] **Step 1: Write a complete decision table test**

Table cases must include:

- all blocking passed gives pass.
- blocking passed plus advisory warning gives warn.
- optional skip gives warn when configured.
- blocking failed gives fail.
- blocking inconclusive gives inconclusive when no error or failure exists.
- configuration or provider error gives error.
- evidence coverage below 90 gives fail.
- completion order does not change outcome.
- rendered gate order remains configuration order.

- [ ] **Step 2: Implement coverage**

Count only evidence requirements for applicable gates. A shared evidence item can satisfy several requirements but each requirement counts once. Skipped gates do not reduce coverage.

- [ ] **Step 3: Implement severity aggregation**

Use the fixed precedence error, fail, inconclusive, warn, pass. Keep outcome, counts, coverage, and ordered blocking reasons in DecisionSummary.

- [ ] **Step 4: Run decision tests**

Run: npm test -- packages/core/test/decisions

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/core
git commit -m "feat(core): aggregate deterministic gate decisions"
~~~

---

### Task 10: Build the guarded transport, retries, and redaction boundary

**Files:**
- Create: packages/providers/package.json
- Create: packages/providers/tsconfig.json
- Create: packages/providers/src/transport/guarded-fetch.ts
- Create: packages/providers/src/transport/retry.ts
- Create: packages/providers/src/transport/url-policy.ts
- Create: packages/providers/src/security/redact.ts
- Create: packages/providers/src/index.ts
- Test: packages/providers/test/transport/guarded-fetch.test.ts
- Test: packages/providers/test/security/redact.test.ts
- Create: tests/contract/fake-http-server.ts

**Interfaces:**
- Consumes: TransportRequest, endpoint policy, retry policy, size limit, and AbortSignal.
- Produces: GuardedTransport.request<T>(), Redactor.redactValue(), and TransportResponse<T>.

- [ ] **Step 1: Write failing URL-policy tests**

Reject HTTP, loopback IPv4 and IPv6, RFC1918 ranges, link-local ranges, cloud metadata addresses, user-info URLs, disallowed ports, cross-origin redirects, and DNS results that resolve to forbidden ranges. Accept only configured HTTPS provider origins and allowlisted probe hosts.

- [ ] **Step 2: Write failing transport tests**

Cover timeout, cancellation, 429 with Retry-After, retryable 502/503/504, non-retryable 401/403/400, connection reset, malformed JSON, HTTP 200 oversized body, maximum attempts, and phase deadline truncating retries.

- [ ] **Step 3: Implement URL validation before and after DNS resolution**

Validate every redirect target and resolved address. Do not send authorization headers across origins.

- [ ] **Step 4: Implement bounded response reading**

Stream response bytes, stop at the configured limit, abort the request, and return PROVIDER_PROTOCOL. Never call response.text before applying the limit.

- [ ] **Step 5: Implement cancellation-aware exponential backoff**

Backoff uses configured initial and maximum delay with bounded jitter. A cancelled sleep throws CANCELLED immediately.

- [ ] **Step 6: Write and implement redaction tests**

Redact keys matching token, password, secret, key, cookie, authorization, and set-cookie regardless of case. Redact URL query strings. Detect bearer tokens inside diagnostic strings. Preserve non-sensitive numeric values and field names needed for remediation.

- [ ] **Step 7: Run transport and security tests**

Run: npm test -- packages/providers/test/transport packages/providers/test/security

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add packages/providers tests/contract package.json package-lock.json
git commit -m "feat(providers): add guarded transport and redaction"
~~~

---

### Task 11: Implement the Prometheus-compatible metrics provider

**Files:**
- Create: packages/providers/src/metrics/types.ts
- Create: packages/providers/src/metrics/prometheus-client.ts
- Create: packages/providers/src/metrics/normalize.ts
- Create: packages/providers/src/metrics/query-guard.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/metrics/prometheus-client.test.ts
- Create: fixtures/providers/prometheus/*.json

**Interfaces:**
- Consumes: Prometheus instant/range request and GuardedTransport.
- Produces: MetricsProvider.queryInstant(), queryRange(), and Evidence<MetricVector | MetricMatrix>.

- [ ] **Step 1: Define metric evidence**

Metric samples carry labels, numeric value, observed timestamp, query start/end/step, sample count, warnings, and canonical identity mapping.

- [ ] **Step 2: Write provider contract tests**

Tests must cover vector, matrix, scalar, empty result, no-data, partial warning, NaN, infinities, malformed sample tuples, stale timestamps, future timestamps, HTTP errors, query timeout, and oversized responses.

- [ ] **Step 3: Add query guards**

Reject query strings over 16 KiB, ranges over the policy limit, steps below one second, and selectors that omit required service/environment scope for production gates.

- [ ] **Step 4: Implement API calls**

Use GET for short queries and POST form encoding when the encoded URL would exceed 4 KiB. Never log the raw query. Put its SHA-256 fingerprint in evidence.

- [ ] **Step 5: Implement normalization**

Return missing for a valid empty vector, invalid for malformed or non-finite values, stale for old samples, and valid typed evidence otherwise.

- [ ] **Step 6: Add the low-traffic review-focus test**

A candidate query with 12 samples when 200 are required must return insufficient evidence. It must not synthesize zero or pass a greater-than-or-equal comparison.

- [ ] **Step 7: Run metrics tests**

Run: npm test -- packages/providers/test/metrics

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add packages/providers/src/metrics packages/providers/test/metrics fixtures/providers/prometheus
git commit -m "feat(providers): query Prometheus-compatible metrics"
~~~

---

### Task 12: Implement Loki and Tempo providers

**Files:**
- Create: packages/providers/src/logs/loki-client.ts
- Create: packages/providers/src/logs/types.ts
- Create: packages/providers/src/traces/tempo-client.ts
- Create: packages/providers/src/traces/types.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/logs/loki-client.test.ts
- Test: packages/providers/test/traces/tempo-client.test.ts
- Create: fixtures/providers/loki/*.json
- Create: fixtures/providers/tempo/*.json

**Interfaces:**
- Consumes: bounded log-range and trace-search requests.
- Produces: Evidence<LogRecordSummary[]> and Evidence<TraceSummary[]>.

- [ ] **Step 1: Write Loki contract tests**

Cover stream responses, structured metadata, empty streams, stale records, malformed nanosecond timestamps, pagination limits, server warnings, unbounded selector rejection, and exclusion of raw log bodies from evidence references.

- [ ] **Step 2: Implement Loki query_range**

Require start, end, direction, and limit. Cap limit by policy. Return only timestamp, selected structured fields, label set, byte count, trace_id, and span_id.

- [ ] **Step 3: Write Tempo contract tests**

Cover trace search by canonical resource fields, empty search, partial traces, server spans, error status, peer relationships, trace duration, stale traces, and sampling-aware absence.

- [ ] **Step 4: Implement Tempo search and trace summary**

Normalize resource.service.name, namespace, version, and deployment environment. Preserve trace and span identifiers only inside typed evidence; reports use fingerprints unless correlation output explicitly needs an ID.

- [ ] **Step 5: Run provider tests**

Run:

~~~bash
npm test -- packages/providers/test/logs packages/providers/test/traces
npm run typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/providers/src/logs packages/providers/src/traces packages/providers/test/logs packages/providers/test/traces fixtures/providers/loki fixtures/providers/tempo
git commit -m "feat(providers): add Loki and Tempo evidence"
~~~

---

### Task 13: Implement the Grafana provider

**Files:**
- Create: packages/providers/src/grafana/client.ts
- Create: packages/providers/src/grafana/types.ts
- Create: packages/providers/src/grafana/dashboard.ts
- Create: packages/providers/src/grafana/alerts.ts
- Create: packages/providers/src/grafana/slo.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/grafana/client.test.ts
- Create: fixtures/providers/grafana/*.json

**Interfaces:**
- Consumes: dashboard UID, alert label selector, notification selector, and SLO UID.
- Produces: Evidence<DashboardSnapshot>, Evidence<AlertRuleSnapshot[]>, Evidence<NotificationRouteSnapshot>, and Evidence<SloSnapshot>.

- [ ] **Step 1: Write dashboard tests**

Test missing dashboard, wrong title, panel signal classification, template variables, insufficient permission, and valid dashboard.

- [ ] **Step 2: Write alert tests**

Test enabled rules, severity/owner/runbook metadata, firing/pending/error states, stale evaluation, critical receiver routing, and mute timing covering the deployment window.

- [ ] **Step 3: Write SLO tests**

Test definition, objective, window, labels, met/unmet/no-data status, remaining budget, consumed budget, and paired burn-rate windows.

- [ ] **Step 4: Implement explicit resource-state mapping**

Distinguish 404 missing, 401 authentication, 403 authorization, 429 transient, 5xx unavailable, valid no-data, and malformed payload.

- [ ] **Step 5: Run Grafana tests**

Run: npm test -- packages/providers/test/grafana

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/providers/src/grafana packages/providers/test/grafana fixtures/providers/grafana
git commit -m "feat(providers): read Grafana dashboard alert and SLO evidence"
~~~

---

### Task 14: Implement evidence-file providers and signature verification

**Files:**
- Create: packages/providers/src/evidence/files.ts
- Create: packages/providers/src/evidence/provenance.ts
- Create: packages/providers/src/evidence/sarif.ts
- Create: packages/providers/src/evidence/otlp-contract.ts
- Create: packages/providers/src/evidence/deployment.ts
- Create: packages/providers/src/evidence/synthetic.ts
- Create: packages/providers/src/evidence/incidents.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/evidence/*.test.ts
- Create: fixtures/evidence/sarif/*
- Create: fixtures/evidence/otlp/*
- Create: fixtures/evidence/deployment/*
- Create: fixtures/evidence/synthetic/*
- Create: fixtures/evidence/incidents/*

**Interfaces:**
- Consumes: workspace-relative file definitions, freshness policy, expected provenance, trusted issuer, and audience.
- Produces: typed Evidence for SARIF, OTLP contract, signed deployment, synthetic, and incident data.

- [ ] **Step 1: Write path and file-boundary tests**

Reject absolute paths, traversal, out-of-workspace symlinks, non-regular files, world-writable blocking evidence, files over 25 MiB, stale evidence, and timestamps beyond future skew.

- [ ] **Step 2: Implement safe file loading**

Resolve realpath, verify workspace containment, lstat and stat the target, read with a size-bound stream, calculate SHA-256, and parse only after boundary checks.

- [ ] **Step 3: Write and implement SARIF parsing**

Extract run, rule ID, level, message, and location. Accept only configured instrumentation rule families. Preserve file locations for SARIF reporting. Treat absent optional SARIF as missing rather than unavailable.

- [ ] **Step 4: Write and implement OTLP contract parsing**

Validate metrics, logs, and traces; resource attributes; trace-log correlation; span error status; normalized HTTP route; forbidden cardinality keys; and forbidden sensitive fields. Require commit and workflow provenance.

- [ ] **Step 5: Write and implement signed deployment evidence**

Use a compact signed payload with issuer, audience, subject, target, deploymentId, commit, releaseId, artifact digest, previous release, deployedAt, workflow identity, issuedAt, and expiresAt. Verify signature, issuer, audience, expiry, workflow identity, and payload/file digest before parsing domain fields.

- [ ] **Step 6: Write and implement synthetic and incident parsing**

Support JUnit XML and product JSON for synthetics. Normalize test name, status, duration, timestamp, and observed release header. Normalize incident service, environment, severity, state, and update time.

- [ ] **Step 7: Run evidence tests**

Run: npm test -- packages/providers/test/evidence

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add packages/providers/src/evidence packages/providers/test/evidence fixtures/evidence
git commit -m "feat(providers): validate trusted file evidence"
~~~

---

### Task 15: Implement the Kubernetes runtime adapter

**Files:**
- Create: packages/providers/src/runtime/types.ts
- Create: packages/providers/src/runtime/kubernetes/client.ts
- Create: packages/providers/src/runtime/kubernetes/adapter.ts
- Create: packages/providers/src/runtime/kubernetes/normalize.ts
- Create: packages/providers/src/runtime/kubernetes/manifest.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/runtime/kubernetes/*.test.ts
- Create: fixtures/providers/kubernetes/*.json
- Create: fixtures/manifests/kubernetes/*.yml

**Interfaces:**
- Consumes: active Kubernetes target, KubeConfig, deployment window, and AbortSignal.
- Produces: RuntimeAdapter.getSnapshot(), KubernetesRolloutEvidence, KubernetesImageEvidence, KubernetesPodEvidence, KubernetesEventEvidence, and parsed manifest evidence.

- [ ] **Step 1: Install the Kubernetes client**

Run:

~~~bash
npm install --workspace packages/providers --save-exact @kubernetes/client-node
~~~

- [ ] **Step 2: Write snapshot normalization tests**

Cover Deployment, StatefulSet, and DaemonSet; observed generation; desired/updated/ready/available/unavailable replicas; owner-reference selection; rollout conditions; pod readiness; imageID digest; restarts; waiting and termination reasons; OOMKilled; and warning events.

- [ ] **Step 3: Implement read-only client construction**

Load the configured context or default KubeConfig. Construct AppsV1Api and CoreV1Api clients only. The adapter source must contain no create, patch, replace, delete, exec, attach, or port-forward calls.

- [ ] **Step 4: Implement resource resolution**

Read the selected workload, list related ReplicaSets and Pods by selector and owner references, and list namespace events filtered to involved resources and deployment time.

- [ ] **Step 5: Implement normalized snapshot**

Map workload and pods into RuntimeSnapshot. Preserve Kubernetes-specific details in separate evidence objects.

- [ ] **Step 6: Implement manifest parsing**

Parse the selected rendered workload and related PodDisruptionBudget. Extract image, security context, probes, resources, replicas, strategy, progress deadline, minimum ready seconds, and disruption budget.

- [ ] **Step 7: Add permission and pagination tests**

A 403 maps to AUTHORIZATION. Pagination continues until no token remains. Cancellation stops between pages.

- [ ] **Step 8: Run Kubernetes adapter tests**

Run: npm test -- packages/providers/test/runtime/kubernetes

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add packages/providers/src/runtime packages/providers/test/runtime fixtures/providers/kubernetes fixtures/manifests/kubernetes package.json package-lock.json
git commit -m "feat(runtime): add read-only Kubernetes adapter"
~~~

---

### Task 16: Implement Azure Container Apps and Azure VM adapters

**Files:**
- Create: packages/providers/src/runtime/azure/auth.ts
- Create: packages/providers/src/runtime/azure/container-apps.ts
- Create: packages/providers/src/runtime/azure/virtual-machines.ts
- Create: packages/providers/src/runtime/azure/normalize.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/runtime/azure/*.test.ts
- Create: fixtures/providers/azure/container-apps/*.json
- Create: fixtures/providers/azure/virtual-machines/*.json
- Create: fixtures/manifests/container-apps/*.json

**Interfaces:**
- Consumes: Azure target, TokenCredential, subscription and resource identifiers.
- Produces: RuntimeSnapshot, ContainerAppRevisionEvidence, ContainerAppTrafficEvidence, ContainerAppReplicaEvidence, AzureVmInstanceViewEvidence, and parsed rendered configuration.

- [ ] **Step 1: Install Azure clients**

Run:

~~~bash
npm install --workspace packages/providers --save-exact @azure/identity @azure/arm-appcontainers @azure/arm-compute
~~~

- [ ] **Step 2: Write authentication tests**

DefaultAzureCredential is constructed only for Azure targets. Missing subscription fails before a network call. Authentication and authorization remain distinct. No client-secret value enters diagnostics.

- [ ] **Step 3: Write Container Apps contract tests**

Cover application missing, revision missing, provisioning state, running state, active flag, image identity, revision suffix, healthy and failed replicas, traffic weights summing to 100, unknown revision traffic, activation failures, and paginated revision listing.

- [ ] **Step 4: Implement the Container Apps adapter**

Construct ContainerAppsAPIClient with TokenCredential. Use get and list operations only. Normalize application, revision, replica, image, and traffic data.

- [ ] **Step 5: Parse rendered Container Apps configuration**

Extract image identity, revision mode, ingress transport, scale bounds, probes, managed identity, and OTel environment configuration.

- [ ] **Step 6: Write Azure VM contract tests**

Cover provisioning succeeded/failed, power running/stopped, maintenance state, missing VM, malformed status codes, and cancellation.

- [ ] **Step 7: Implement the VM adapter**

Construct ComputeManagementClient with TokenCredential. Read instance view only and normalize provisioning, power, and maintenance signals. Application service and release identity remain telemetry/evidence responsibilities.

- [ ] **Step 8: Run Azure tests**

Run: npm test -- packages/providers/test/runtime/azure

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add packages/providers/src/runtime/azure packages/providers/test/runtime/azure fixtures/providers/azure fixtures/manifests/container-apps package.json package-lock.json
git commit -m "feat(runtime): add Azure Container Apps and VM adapters"
~~~

---

### Task 17: Implement generic VM evidence and safe HTTP probes

**Files:**
- Create: packages/providers/src/runtime/vm/adapter.ts
- Create: packages/providers/src/runtime/vm/service-evidence.ts
- Create: packages/providers/src/runtime/vm/host-evidence.ts
- Create: packages/providers/src/http/probe.ts
- Modify: packages/providers/src/index.ts
- Test: packages/providers/test/runtime/vm/*.test.ts
- Test: packages/providers/test/http/probe.test.ts

**Interfaces:**
- Consumes: metrics provider, signed deployment evidence, target operating system, release marker, and allowlisted HTTP assertion.
- Produces: RuntimeSnapshot for evidence-only targets, VmServiceEvidence, VmHostEvidence, VmAgentEvidence, and HttpProbeEvidence.

- [ ] **Step 1: Write generic VM tests**

Cover Windows service running/stopped and exit code; systemd active/failed; host CPU, memory, disk, load; unavailable hosts; telemetry agent up, export failures, queue utilization, and last export age; release marker agreement; and a host missing from one evidence source.

- [ ] **Step 2: Implement evidence-only runtime normalization**

Join hosts by stable host or instance ID. A host absent from required evidence becomes unavailable, not healthy. Never invoke a process, shell, SSH client, or WinRM client.

- [ ] **Step 3: Write HTTP probe tests**

Cover 200 JSON success, wrong status, wrong release header, invalid JSON, timeout, oversized response, forbidden redirect, forbidden address, TLS failure, and cancellation.

- [ ] **Step 4: Implement the probe over GuardedTransport**

Support GET and HEAD only. Compare configured status, bounded headers, and exact shallow JSON fields. Exclude response body from reports.

- [ ] **Step 5: Run VM and HTTP tests**

Run:

~~~bash
npm test -- packages/providers/test/runtime/vm packages/providers/test/http
npm run typecheck
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/providers/src/runtime/vm packages/providers/src/http packages/providers/test/runtime/vm packages/providers/test/http
git commit -m "feat(runtime): add VM evidence and guarded probes"
~~~

---

### Task 18: Implement pre-deployment readiness gates

**Files:**
- Create: packages/gates/src/pre/readiness/policy.ts
- Create: packages/gates/src/pre/readiness/identity.ts
- Create: packages/gates/src/pre/readiness/assets.ts
- Create: packages/gates/src/pre/readiness/queries.ts
- Create: packages/gates/src/pre/readiness/instrumentation.ts
- Create: packages/gates/src/pre/readiness/telemetry-contract.ts
- Create: packages/gates/src/pre/readiness/collector-config.ts
- Create: packages/gates/src/pre/readiness/synthetic-plan.ts
- Create: packages/gates/src/pre/readiness/coverage.ts
- Create: packages/gates/src/register-readiness.ts
- Test: packages/gates/test/pre/readiness/*.test.ts
- Create: fixtures/repositories/readiness-pass/*
- Create: fixtures/repositories/readiness-fail/*

**Interfaces:**
- Consumes: configuration, repository files, Grafana evidence, SARIF evidence, OTLP contract evidence, and collector configuration.
- Produces gate types: policy.self_check, identity.contract, asset.metadata, asset.url, grafana.dashboard, grafana.alert_rules, grafana.notification_policy, grafana.slo_definition, telemetry.query_validation, artifact.instrumentation_configuration, evidence.sarif, evidence.otlp_contract, telemetry.pipeline_configuration, synthetic.plan, and policy.coverage.

- [ ] **Step 1: Write a catalogue coverage test**

Register readiness gate types and assert the reference IDs readiness.policy through readiness.post-gate-coverage resolve to an evaluator with supported phase pre_deployment.

- [ ] **Step 2: Implement policy and identity evaluators**

Policy checks sections, unique IDs, known fields, secret references, and post-gate blocking coverage. Identity checks required values, release ID length and forbidden values, and environment pattern.

- [ ] **Step 3: Implement repository asset evaluators**

Owner reads catalog-info.yaml and CODEOWNERS through the safe file boundary. Runbook performs the constrained URL check. Dashboard, alert rules, notification routing, and SLO use typed Grafana evidence.

- [ ] **Step 4: Implement query validation**

Validate every configured query without executing it. Enforce scalar shape declarations, range bounds, service/environment scoping, and forbidden high-cardinality grouping labels.

- [ ] **Step 5: Implement instrumentation configuration**

Inspect rendered Kubernetes, Container Apps, and VM artifacts for service name, version, environment, OTLP endpoint or agent, enabled signals, TLS, debug exporters, and hardcoded credential patterns.

- [ ] **Step 6: Implement SARIF and OTLP gates**

SARIF maps error to advisory warning and warning to an informational assertion. OTLP contract blocks on missing signal, identity mismatch, missing correlation, incorrect span error status, raw routes, cardinality keys, or sensitive fields.

- [ ] **Step 7: Implement collector and synthetic-plan checks**

Collector parsing validates receiver, memory_limiter, batch, exporters for all signals, pipeline references, retry, sending queue, and TLS. Synthetic plan parsing validates bounded timeout, success assertion, release identity assertion, and secret-safe output.

- [ ] **Step 8: Implement post-gate coverage**

Map registered post gates to the required categories and report every missing category in one result.

- [ ] **Step 9: Run readiness tests**

Run: npm test -- packages/gates/test/pre/readiness

Expected: PASS for the full passing repository and focused failure fixture.

- [ ] **Step 10: Commit**

~~~bash
git add packages/gates/src/pre packages/gates/src/register-readiness.ts packages/gates/test/pre fixtures/repositories
git commit -m "feat(gates): implement pre-deployment readiness"
~~~

---

### Task 19: Implement pre-deployment operational-risk gates

**Files:**
- Create: packages/gates/src/pre/risk/providers.ts
- Create: packages/gates/src/pre/risk/metrics.ts
- Create: packages/gates/src/pre/risk/reliability.ts
- Create: packages/gates/src/pre/risk/alerts-incidents.ts
- Create: packages/gates/src/pre/risk/dependencies.ts
- Create: packages/gates/src/pre/risk/collector.ts
- Create: packages/gates/src/pre/risk/capacity.ts
- Create: packages/gates/src/pre/risk/change-window.ts
- Create: packages/gates/src/pre/risk/concurrency.ts
- Create: packages/gates/src/pre/risk/telemetry-budget.ts
- Create: packages/gates/src/register-risk.ts
- Test: packages/gates/test/pre/risk/*.test.ts

**Interfaces:**
- Consumes: provider health, metric, Grafana reliability, incident, dependency, collector, runtime, change-window, deployment, and OTLP evidence.
- Produces gate types: providers.health, metric.threshold, grafana.slo_status, grafana.error_budget, grafana.burn_rate, grafana.alert_state, evidence.incident_state, dependency.health, telemetry.collector_health, runtime.capacity, policy.change_window, deployment.concurrency, telemetry.cardinality_estimate, and telemetry.volume_estimate.

- [ ] **Step 1: Write risk catalogue and passing-window tests**

Assert all reference IDs risk.telemetry-backends through risk.telemetry-volume resolve for pre_deployment and a complete healthy fixture passes.

- [ ] **Step 2: Implement provider, health, and error-rate gates**

Provider health checks endpoint latency, authentication, and query permissions. Metric threshold evaluates current availability and error rate using valid samples only.

- [ ] **Step 3: Implement SLO, budget, burn, alert, and incident gates**

Require fresh Grafana evidence. Evaluate paired burn windows atomically. Incident gate applies only when configured and fails for major investigating, identified, or monitoring incidents.

- [ ] **Step 4: Implement dependency and collector gates**

All required dependencies must pass. Collector health sums export failures and refused records and checks maximum queue utilization.

- [ ] **Step 5: Implement capacity and concurrency gates**

Runtime capacity evaluates CPU, memory, disk, and rollout-surge schedulability. Deployment concurrency excludes the current deployment ID.

- [ ] **Step 6: Implement change-window exceptions**

Parse .github/change-windows.yml with explicit timezone. A freeze passes only with non-empty exception ID, reason, and approver. Do not print the reason or approver unless policy marks them non-sensitive.

- [ ] **Step 7: Implement telemetry budget advisories**

Evaluate series, attribute-key, and signal-volume estimates. These types must reject blocking enforcement unless the user explicitly overrides the reference policy in a separately validated setting.

- [ ] **Step 8: Run risk tests**

Run: npm test -- packages/gates/test/pre/risk

Expected: PASS, including active-alert, high-burn, no-budget, dependency-down, collector-backpressure, freeze, and concurrent-deployment failures.

- [ ] **Step 9: Commit**

~~~bash
git add packages/gates/src/pre/risk packages/gates/src/register-risk.ts packages/gates/test/pre/risk
git commit -m "feat(gates): implement pre-deployment risk checks"
~~~

---

### Task 20: Implement common post-deployment workload and telemetry gates

**Files:**
- Create: packages/gates/src/post/workload.ts
- Create: packages/gates/src/post/telemetry-presence.ts
- Create: packages/gates/src/post/telemetry-freshness.ts
- Create: packages/gates/src/post/telemetry-contract.ts
- Create: packages/gates/src/post/telemetry-identity.ts
- Create: packages/gates/src/post/telemetry-correlation.ts
- Create: packages/gates/src/post/telemetry-pipeline.ts
- Create: packages/gates/src/post/release-health.ts
- Create: packages/gates/src/register-post-common.ts
- Test: packages/gates/test/post/common/*.test.ts

**Interfaces:**
- Consumes: RuntimeSnapshot, deployment attestation, metric/log/trace evidence, collector evidence, and direct health metrics.
- Produces gate types: runtime.provisioned, runtime.ready, runtime.release_identity, telemetry.presence, telemetry.freshness, telemetry.contract, telemetry.identity_consistency, telemetry.correlation, telemetry.service_graph, telemetry.collector_health, metric.threshold, metric.multi_threshold, and runtime.stability.

- [ ] **Step 1: Write the common post catalogue test**

Assert workload.provisioned through release.stability resolve for post_deployment and declare the required categories.

- [ ] **Step 2: Implement workload gates**

Provisioned checks resource and state after deployedAt. Ready checks consecutive healthy samples. Release identity compares runtime, signed deployment evidence, expected image or artifact digest, release ID, and deployment ID.

- [ ] **Step 3: Add the identity-disagreement test**

Construct healthy runtime, telemetry, and attestation evidence with three different release IDs. Assert workload.release and telemetry.identity-consistency fail and expose only the sanitized observed IDs.

- [ ] **Step 4: Implement presence and freshness**

Metrics, logs, and traces each require matching canonical identity. Freshness evaluates each signal separately and reports age. One fresh signal cannot hide another stale signal.

- [ ] **Step 5: Implement live telemetry contract and identity consistency**

Validate required signals, resources, request metric, error logs, server spans, and forbidden fields. Compare canonical identity across runtime, metrics, logs, traces, and attestation.

- [ ] **Step 6: Implement correlation and service graph**

Correlation samples configured error traces and calculates logs containing matching trace_id and span_id. Service graph verifies caller, dependencies, and unknown peer percentage as advisory.

- [ ] **Step 7: Implement direct release health**

Register error rate, latency, availability, throughput, saturation, and stability evaluators. Require traffic and minimum request samples before rate or latency gates can pass.

- [ ] **Step 8: Run common post tests**

Run: npm test -- packages/gates/test/post/common

Expected: PASS.

- [ ] **Step 9: Commit**

~~~bash
git add packages/gates/src/post packages/gates/src/register-post-common.ts packages/gates/test/post/common
git commit -m "feat(gates): implement common post-deployment checks"
~~~

---

### Task 21: Implement regression, reliability, dependency, synthetic, and custom gates

**Files:**
- Create: packages/gates/src/post/comparison/baseline.ts
- Create: packages/gates/src/post/comparison/metric.ts
- Create: packages/gates/src/post/comparison/multi-metric.ts
- Create: packages/gates/src/post/comparison/trace-metrics.ts
- Create: packages/gates/src/post/comparison/telemetry-volume.ts
- Create: packages/gates/src/post/reliability.ts
- Create: packages/gates/src/post/dependencies.ts
- Create: packages/gates/src/post/synthetic.ts
- Create: packages/gates/src/post/http.ts
- Create: packages/gates/src/register-post-reliability.ts
- Test: packages/gates/test/post/comparison/*.test.ts
- Test: packages/gates/test/post/reliability/*.test.ts

**Interfaces:**
- Consumes: candidate evidence, an explicit baseline and author-selected query windows, measured Grafana reliability, dependency, synthetic, and HTTP evidence.
- Produces: comparison.metric, comparison.multi_metric, comparison.trace_metrics, comparison.telemetry_volume, Grafana reliability types, dependency.health, synthetic.result, and http.assertion.

- [ ] **Step 1: Write baseline-selection tests**

Test explicit baseline, rejection of unsupported discovery/filtering/extension, missing baseline,
insufficient samples, and candidate/baseline identity collision.

- [ ] **Step 2: Implement baseline selection**

Require an explicit release ID. Reject unsupported discovery/filtering settings rather than
silently ignoring them. Return insufficient evidence when the requested observations cannot support comparison.

- [ ] **Step 3: Write comparison math tests**

Cover absolute-only failure, relative-only failure, both limits passing, zero baseline, negative invalid values, per-request normalization, mismatched units, and low candidate/baseline sample counts.

- [ ] **Step 4: Implement metric comparisons**

Evaluate absolute and relative rules independently and require both. Include candidate, baseline, delta, percentage delta, units, window, and samples in assertion output.

- [ ] **Step 5: Implement multi-metric, trace, and volume comparisons**

CPU and memory normalize per request. Dependency latency groups only expected peers. Telemetry volume calculates metric series, log bytes, and spans per request and remains advisory.

- [ ] **Step 6: Implement reliability gates**

Use fresh Grafana evidence for SLO status, remaining and consumed budget, paired burn windows, and candidate-period alerts.

- [ ] **Step 7: Implement dependency, synthetic, HTTP, and custom metrics**

All required dependencies pass independently. Synthetic requires named tests, 100 percent pass rate, duration bounds, and release header. HTTP consumes guarded probe evidence. Custom metric uses the same metric.threshold evaluator with advisory enforcement.

- [ ] **Step 8: Add low-traffic and missing-baseline review-focus tests**

Assert comparison gates return inconclusive for 199 candidate requests when 200 are required and for an undiscoverable baseline. Neither case may return pass.

- [ ] **Step 9: Run post reliability tests**

Run:

~~~bash
npm test -- packages/gates/test/post/comparison packages/gates/test/post/reliability
npm run typecheck
~~~

Expected: PASS.

- [ ] **Step 10: Commit**

~~~bash
git add packages/gates/src/post/comparison packages/gates/src/post/reliability.ts packages/gates/src/post/dependencies.ts packages/gates/src/post/synthetic.ts packages/gates/src/post/http.ts packages/gates/src/register-post-reliability.ts packages/gates/test/post
git commit -m "feat(gates): implement regression and reliability checks"
~~~

---

### Task 22: Implement Kubernetes pre- and post-deployment gates

**Files:**
- Create: packages/gates/src/platform/kubernetes/pre.ts
- Create: packages/gates/src/platform/kubernetes/post.ts
- Create: packages/gates/src/register-kubernetes.ts
- Test: packages/gates/test/platform/kubernetes/*.test.ts

**Interfaces:**
- Consumes: rendered manifest and Kubernetes runtime evidence.
- Produces: kubernetes.manifest, kubernetes.probes, kubernetes.resources, kubernetes.rollout_strategy, kubernetes.rollout_status, kubernetes.image_identity, kubernetes.pod_health, and kubernetes.events.

- [ ] **Step 1: Write pre-deployment fixture tests**

Fail fixtures for mutable latest image, non-digest image, privileged container, writable root filesystem, missing readiness/liveness/startup probes, probe timeout over five seconds, missing requests, memory limit missing, one production replica, missing disruption budget, Recreate strategy, maxUnavailable over one, and missing progress deadline.

- [ ] **Step 2: Implement pre-deployment gates**

Use parsed manifest evidence only. Report YAML document and field path for every failing assertion so SARIF can locate it.

- [ ] **Step 3: Write post-deployment fixture tests**

Cover generation mismatch, progressing false, available false, replica mismatch, rollout timeout, digest mismatch, restart increase, CrashLoopBackOff, ImagePullBackOff, ErrImagePull, config error, OOMKilled, unhealthy probes, eviction, failed scheduling, mount failure, and advisory warning events.

- [ ] **Step 4: Implement post-deployment gates**

Use runtime adapter evidence and deployment window. Image identity compares imageID digest, not only the manifest tag.

- [ ] **Step 5: Run Kubernetes gate tests**

Run: npm test -- packages/gates/test/platform/kubernetes

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/gates/src/platform/kubernetes packages/gates/src/register-kubernetes.ts packages/gates/test/platform/kubernetes
git commit -m "feat(gates): implement Kubernetes platform policy"
~~~

---

### Task 23: Implement Azure Container Apps pre- and post-deployment gates

**Files:**
- Create: packages/gates/src/platform/container-apps/pre.ts
- Create: packages/gates/src/platform/container-apps/post.ts
- Create: packages/gates/src/register-container-apps.ts
- Test: packages/gates/test/platform/container-apps/*.test.ts

**Interfaces:**
- Consumes: rendered Container Apps configuration and runtime evidence.
- Produces: azure_container_apps.configuration, probes, revision_status, image_identity, traffic, and replica_health.

- [ ] **Step 1: Write pre-deployment tests**

Cover digest pinning, Multiple revision mode, ingress transport, minimum and maximum replicas, OTel environment, managed identity, startup/readiness/liveness probes, and probe port matching ingress.

- [ ] **Step 2: Implement pre-deployment evaluators**

Emit exact JSON paths for configuration failures.

- [ ] **Step 3: Write post-deployment tests**

Cover provisioning failed, running degraded, inactive revision, insufficient healthy replicas, failed replicas, image mismatch, revision suffix mismatch, candidate traffic below minimum, unknown revision traffic, weights not summing to 100, restarts, activation failures, and deactivation failures.

- [ ] **Step 4: Implement post-deployment evaluators**

Traffic validation observes only; remediation explicitly states that the workflow owns correction.

- [ ] **Step 5: Run Container Apps gate tests**

Run: npm test -- packages/gates/test/platform/container-apps

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add packages/gates/src/platform/container-apps packages/gates/src/register-container-apps.ts packages/gates/test/platform/container-apps
git commit -m "feat(gates): implement Container Apps platform policy"
~~~

---

### Task 24: Implement Azure, Linux, and Windows VM gates

**Files:**
- Create: packages/gates/src/platform/vm/pre.ts
- Create: packages/gates/src/platform/vm/post.ts
- Create: packages/gates/src/register-vm.ts
- Test: packages/gates/test/platform/vm/*.test.ts

**Interfaces:**
- Consumes: service definition, signed deployment evidence, Azure instance view, service metrics, release marker, host metrics, and agent metrics.
- Produces: vm.release_identity, vm.service_definition, vm.capacity, azure_vm.instance_view, vm.service_health, vm.release_marker, vm.host_health, and vm.agent_health.

- [ ] **Step 1: Write pre-deployment tests**

Cover missing artifact digest, release marker, service.version, rollback artifact, restart-on-failure, restart delay, startup timeout, graceful shutdown, non-admin identity, telemetry agent dependency, host headroom, and healthy host percentage.

- [ ] **Step 2: Implement service-definition parsing**

Support a bounded JSON representation for Windows services and a bounded systemd unit parser for Linux. Reject executable directives that attempt to embed shell pipelines in observability configuration.

- [ ] **Step 3: Write post-deployment tests**

Cover Azure provisioning/power state, Windows running/stopped/exit code, systemd active/failed, restart increase, missing hosts, mixed release markers, CPU/memory/disk/load saturation, agent down, export failure, queue saturation, and stale export.

- [ ] **Step 4: Implement VM evaluators**

Join host evidence by stable instance ID. Require 100 percent release identity and service health where configured. A missing host fails rather than reducing the denominator.

- [ ] **Step 5: Add a prohibited-operation source scan**

The test scans production source for imports or invocation names associated with ssh, winrm, child_process, exec, spawn, kubectl, az CLI, and shell execution. Maintain an explicit allowlist for test helpers only.

- [ ] **Step 6: Run VM gate tests**

Run: npm test -- packages/gates/test/platform/vm

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add packages/gates/src/platform/vm packages/gates/src/register-vm.ts packages/gates/test/platform/vm
git commit -m "feat(gates): implement VM platform policy"
~~~

---

### Task 25: Register every gate type and validate reference-policy coverage

**Files:**
- Create: packages/gates/src/register-all.ts
- Modify: packages/gates/src/index.ts
- Create: packages/gates/test/reference-policy-coverage.test.ts
- Create: tests/contract/reference-policy-schema.test.ts

**Interfaces:**
- Consumes: all gate registration functions and the approved reference YAML.
- Produces: createBuiltInGateCatalog(): GateCatalog.

- [ ] **Step 1: Register all built-in gate families**

Call registerReadiness, registerRisk, registerPostCommon, registerPostReliability, registerKubernetes, registerContainerApps, and registerVm in a fixed order.

- [ ] **Step 2: Write exhaustive reference-policy tests**

Load observability-gate.yml and assert:

- exactly 39 pre-deployment and 47 post-deployment IDs are present.
- all 86 IDs are unique.
- every gate type resolves.
- every resolved type supports its configured phase.
- every gate-specific definition parses.
- every required provider capability exists.
- every when condition is supported.
- all blocking post categories required by readiness.post-gate-coverage are present.
- no prohibited operation exists.
- the policy contains no top-level version or schema_version.

- [ ] **Step 3: Generate and snapshot the gate catalogue**

Catalogue output includes type, description, phases, provider requirements, condition keys, assertion schema, and remediation support. Snapshot order is stable by type.

- [ ] **Step 4: Run coverage tests**

Run:

~~~bash
npm test -- packages/gates/test/reference-policy-coverage.test.ts tests/contract/reference-policy-schema.test.ts
~~~

Expected: PASS with 86 covered gate IDs and no unknown type.

- [ ] **Step 5: Commit**

~~~bash
git add packages/gates/src/register-all.ts packages/gates/src/index.ts packages/gates/test/reference-policy-coverage.test.ts tests/contract/reference-policy-schema.test.ts
git commit -m "feat(gates): register complete gate catalogue"
~~~

---

### Task 26: Implement the application service and observation scheduler

**Files:**
- Create: packages/core/src/application/run-gate.ts
- Create: packages/core/src/application/run-phase.ts
- Create: packages/core/src/application/service.ts
- Create: packages/core/src/execution/scheduler.ts
- Create: packages/core/src/execution/deadline.ts
- Modify: packages/core/src/index.ts
- Test: packages/core/test/application/service.test.ts
- Test: packages/core/test/execution/scheduler.test.ts

**Interfaces:**
- Consumes: ExecutionRequest, policy loader, planner, provider factory, gate catalogue, reporters, clock, and AbortSignal.
- Produces: ObservabilityGateService.validate(), plan(), and run(): Promise<ExecutionResult>.

- [ ] **Step 1: Write application-service orchestration tests**

Use fakes to verify call order: load, interpolate, validate references, plan, initialize only required providers, acquire evidence, execute gates, aggregate, report. Assert an invalid config performs zero provider calls.

- [ ] **Step 2: Write scheduler tests**

Verify global concurrency eight, per-provider concurrency four, configuration-order results, shared EvidenceStore, fail_fast false, overall deadline, gate deadline, warmup, sampling intervals, minimum successful samples, and maximum extension.

- [ ] **Step 3: Implement cancellation-safe scheduler**

Use a root AbortSignal and child timeout signals. Stop queuing new work after cancellation. Wait only for already-settled cleanup and return CANCELLED error; never aggregate a cancelled partial run to pass.

- [ ] **Step 4: Implement phase observation**

Pre-deployment takes a current snapshot. Post-deployment waits warmup, samples until minimum successful samples or deadline, classifies low traffic, and hands all samples to gates.

- [ ] **Step 5: Implement service methods**

validate returns diagnostics without network access. plan returns a redacted execution plan without credentials. run returns immutable ExecutionResult and invokes reporters only after aggregation.

- [ ] **Step 6: Add cancellation review-focus tests**

Cancel during retry, warmup, provider request, and reporter call. Assert completion within one second of fake-clock advancement and decision is error with CANCELLED, never pass.

- [ ] **Step 7: Run application tests**

Run: npm test -- packages/core/test/application packages/core/test/execution

Expected: PASS.

- [ ] **Step 8: Commit**

~~~bash
git add packages/core/src/application packages/core/src/execution packages/core/test/application packages/core/test/execution
git commit -m "feat(core): orchestrate complete gate execution"
~~~

---

### Task 27: Implement canonical and projected reporters

**Files:**
- Create: packages/reporters/package.json
- Create: packages/reporters/tsconfig.json
- Create: packages/reporters/src/json.ts
- Create: packages/reporters/src/markdown.ts
- Create: packages/reporters/src/junit.ts
- Create: packages/reporters/src/sarif.ts
- Create: packages/reporters/src/files.ts
- Create: packages/reporters/src/index.ts
- Test: packages/reporters/test/*.test.ts
- Create: fixtures/reports/execution-result.json
- Create: fixtures/reports/golden/*

**Interfaces:**
- Consumes: immutable ExecutionResult and reporting policy.
- Produces: writeReports(), JSON report, Markdown summary, JUnit XML, and SARIF.

- [ ] **Step 1: Write canonical JSON golden test**

Assert stable field order, result order, identity, decision, coverage, assertions, evidence references, diagnostics, remediation, links, and configuration fingerprint. Assert raw provider responses and secrets are absent.

- [ ] **Step 2: Implement canonical JSON serialization**

Use an explicit report DTO rather than JSON.stringify on domain objects. Sort map keys but preserve gate and assertion order.

- [ ] **Step 3: Write and implement Markdown summary**

Failed blocking gates appear first, then inconclusive, advisory, skipped, comparisons, and links. Include observed versus expected values, unit, window, sample count, evidence age, release, target, and remediation.

- [ ] **Step 4: Write and implement JUnit**

Map each gate to a testcase. Blocking failed, inconclusive, and error become failures. Advisory warnings and explicit skips become skipped entries with messages. Escape XML safely.

- [ ] **Step 5: Write and implement SARIF**

Only findings with stable artifact locations become SARIF results. Runtime-only failures stay out. Map severity and include gate ID as rule ID.

- [ ] **Step 6: Implement atomic file writes**

Write to a same-directory temporary file, fsync, rename, and enforce total report size. If canonical JSON fails, return REPORTING error. A secondary projection failure produces error without changing a prior fail to pass.

- [ ] **Step 7: Add report cancellation test**

Cancel before atomic rename and assert no partial target file exists.

- [ ] **Step 8: Run reporter tests**

Run: npm test -- packages/reporters/test

Expected: PASS and golden files match.

- [ ] **Step 9: Commit**

~~~bash
git add packages/reporters fixtures/reports package.json package-lock.json
git commit -m "feat(reporting): render evidence-rich gate reports"
~~~

---

### Task 28: Implement the CLI

**Files:**
- Create: packages/cli/package.json
- Create: packages/cli/tsconfig.json
- Create: packages/cli/src/main.ts
- Create: packages/cli/src/commands/validate.ts
- Create: packages/cli/src/commands/plan.ts
- Create: packages/cli/src/commands/run.ts
- Create: packages/cli/src/commands/explain.ts
- Create: packages/cli/src/commands/catalog.ts
- Create: packages/cli/src/output.ts
- Test: packages/cli/test/*.test.ts

**Interfaces:**
- Consumes: ObservabilityGateService and built-in catalogue.
- Produces: observability-gate validate, plan, run, explain, and catalog commands with configured exit codes.

- [ ] **Step 1: Install the CLI parser**

Run:

~~~bash
npm install --workspace packages/cli --save-exact commander
npm install --workspace packages/cli --save-exact @observability-gate/core @observability-gate/config @observability-gate/gates @observability-gate/providers @observability-gate/reporters
~~~

- [ ] **Step 2: Write CLI contract tests**

Test help, unknown command, missing config, validate success/failure, plan without credentials, run phase validation, target override, explain known/unknown gate, catalog stable order, JSON output, human output, and SIGINT cancellation.

- [ ] **Step 3: Implement commands**

validate and plan must make zero provider network calls. run accepts config, phase, target, and output-directory. explain accepts a gate type or configured gate ID when a config is supplied.

- [ ] **Step 4: Implement exit-code mapping**

Map pass to 0, warn to 0, fail to 1, inconclusive to 2, error and cancellation to 3, matching the reference policy.

- [ ] **Step 5: Protect output**

Standard output contains user-facing results. Diagnostics go to standard error. Neither stream prints credential values, raw queries, raw logs, or response bodies.

- [ ] **Step 6: Run CLI tests**

Run: npm test -- packages/cli/test

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add packages/cli package.json package-lock.json
git commit -m "feat(cli): expose validation planning and execution"
~~~

---

### Task 29: Implement the GitHub JavaScript Action

**Files:**
- Create: action.yml
- Create: packages/action/package.json
- Create: packages/action/tsconfig.json
- Create: packages/action/src/main.ts
- Create: packages/action/src/inputs.ts
- Create: packages/action/src/github-reporter.ts
- Create: packages/action/src/outputs.ts
- Create: packages/action/rollup.config.js
- Create: packages/action/test/*.test.ts
- Create: dist/index.js
- Create: dist/index.js.map
- Create: .github/workflows/action-test.yml

**Interfaces:**
- Consumes: Action inputs config, phase, target, output-directory, optional github-token, GitHub context, and process signals.
- Produces: GitHub step conclusion, outputs, step summary, optional check run, annotations, and optional PR comment.

- [ ] **Step 1: Install Action dependencies**

Run:

~~~bash
npm install --workspace packages/action --save-exact @actions/core @actions/github
npm install --workspace packages/action --save-exact @observability-gate/core @observability-gate/config @observability-gate/gates @observability-gate/providers @observability-gate/reporters
~~~

- [ ] **Step 2: Define action.yml**

Use runs.using node24 and runs.main dist/index.js. Define inputs config, phase, target, output-directory, and github-token. Define every output from the reference YAML. Do not define credentials as Action inputs.

- [ ] **Step 3: Write Action adapter tests**

Mock @actions/core and @actions/github. Test required inputs, outputs, pass, warn, fail, inconclusive, error, summary, annotation cap 50, optional PR comment update marker, missing write permission, absent token, and redaction.

- [ ] **Step 4: Implement main**

Create a root AbortController. Bind SIGINT, SIGTERM, and process cancellation to abort. Invoke ObservabilityGateService once. Set all outputs from ExecutionResult. Call setFailed for fail, inconclusive, and error; do not fail warn.

- [ ] **Step 5: Implement GitHub reporting**

Always write the step summary when enabled. Publish a separate check only when configured and authorized. Update one PR comment by marker. Permission failure becomes a reporting diagnostic and follows configured reporting criticality.

- [ ] **Step 6: Add release-identity end-to-end adapter test**

Run the Action against fake healthy providers where runtime, attestation, and telemetry disagree. Assert the Action fails, annotations name both identity gates, outputs contain fail, and no token appears.

- [ ] **Step 7: Bundle with Rollup**

Bundle all runtime dependencies into dist/index.js, preserve source map, and ensure no dynamic imports or external production dependencies remain.

- [ ] **Step 8: Test the checked-in bundle**

The workflow invokes the repository Action with fixtures, not tsx or source imports. It runs one passing validation scenario and one expected failing post-deployment scenario.

- [ ] **Step 9: Run Action checks**

Run:

~~~bash
npm test -- packages/action/test
npm run build
git diff --exit-code
~~~

Expected: tests pass, bundle is current, and the build leaves no uncommitted generated change.

- [ ] **Step 10: Commit**

~~~bash
git add action.yml packages/action dist .github/workflows/action-test.yml package.json package-lock.json
git commit -m "feat(action): publish GitHub Actions entry point"
~~~

---

### Task 30: Generate reference documentation and examples

**Files:**
- Create: scripts/generate-docs.ts
- Create: docs/configuration.md
- Create: docs/gates.md
- Create: docs/providers.md
- Create: docs/runtimes/kubernetes.md
- Create: docs/runtimes/azure-container-apps.md
- Create: docs/runtimes/azure-vm.md
- Create: docs/runtimes/linux-vm.md
- Create: docs/runtimes/windows-vm.md
- Create: docs/telemetry-identity.md
- Create: docs/otlp-contract.md
- Create: docs/deployment-evidence.md
- Create: docs/security.md
- Create: docs/troubleshooting.md
- Create: examples/workflows/pre-and-post.yml
- Create: examples/observability-gate.yml
- Modify: README.md
- Test: tests/contract/generated-docs.test.ts

**Interfaces:**
- Consumes: config schemas, gate catalogue metadata, provider capabilities, and reference policy.
- Produces: synchronized documentation and complete example workflow.

- [ ] **Step 1: Write generated-document drift test**

Run the generator into a temporary directory and compare generated configuration, gate, provider, and error-code tables with committed docs.

- [ ] **Step 2: Implement documentation generation**

Generate field paths, types, required status, defaults, allowed values, gate types, phases, provider requirements, assertions, conditions, error codes, and remediation support from source metadata.

- [ ] **Step 3: Write runtime and identity guides**

Document permissions, canonical OpenTelemetry keys, metrics underscore mappings, target fields, evidence requirements, no-SSH/WinRM rule, and platform-specific gates.

- [ ] **Step 4: Write the complete workflow example**

The workflow contains a pre-deployment gate, a concrete user-owned deployment job
that publishes deployed_at and previous_release outputs, a post-deployment gate,
least-privilege permissions, environment references, artifact transfer, and full-SHA
Action references.

- [ ] **Step 5: Copy the approved reference policy**

examples/observability-gate.yml must match ../../../observability-gate.yml byte-for-byte in its source task. Add a test that compares them.

- [ ] **Step 6: Write troubleshooting by stable error code**

For every GateError code, document meaning, likely causes, safe diagnostic commands, and remediation. Do not instruct users to weaken security or treat no-data as success.

- [ ] **Step 7: Run documentation tests**

Run:

~~~bash
npm test -- tests/contract/generated-docs.test.ts
npm run docs:generate
git diff --exit-code
~~~

Expected: generated documentation is current and the reference policy is identical.

- [ ] **Step 8: Commit**

~~~bash
git add scripts docs examples README.md tests/contract/generated-docs.test.ts package.json
git commit -m "docs: publish complete policy and provider reference"
~~~

---

### Task 31: Add end-to-end, security, and failure-injection suites

**Files:**
- Create: tests/end-to-end/pre-deployment.test.ts
- Create: tests/end-to-end/post-deployment.test.ts
- Create: tests/end-to-end/cancellation.test.ts
- Create: tests/integration/fake-observability-stack.ts
- Create: tests/integration/kubernetes-kind.test.ts
- Create: tests/security/ssrf.test.ts
- Create: tests/security/files.test.ts
- Create: tests/security/redaction.test.ts
- Create: tests/security/prohibited-operations.test.ts
- Create: tests/failure-injection/providers.test.ts
- Create: docker/e2e-service/*
- Create: docker/otel-collector/*
- Create: .github/workflows/e2e.yml

**Interfaces:**
- Consumes: built CLI, Action bundle, example policy, fake telemetry stack, kind cluster, and sample instrumented service.
- Produces: release-level proof for passing and failing pre/post flows.

- [ ] **Step 1: Build the sample instrumented service**

The service exposes health and checkout endpoints, emits metrics, structured correlated logs, server/client traces, build info, deliberate latency, and deliberate errors. It accepts RELEASE_ID and ENVIRONMENT.

- [ ] **Step 2: Implement fake observability APIs**

Serve deterministic Prometheus, Loki, Tempo, and Grafana endpoints with scenario selection. Record request counts so tests verify evidence deduplication and bounded concurrency.

- [ ] **Step 3: Implement pre-deployment scenarios**

Cover full pass, missing runbook, invalid query, SARIF advisory, broken OTLP identity, high cardinality, active alert, exhausted budget, collector backpressure, freeze, and Kubernetes manifest failure.

- [ ] **Step 4: Implement post-deployment scenarios**

Cover full pass, wrong release, absent signal, stale signal, broken correlation, high error rate, latency regression, insufficient traffic, missing baseline, burn rate, synthetic failure, Kubernetes rollout failure, Container Apps revision failure, and VM release-marker mismatch.

- [ ] **Step 5: Implement security scenarios**

Exercise alternate IPv4 forms, IPv6, redirects, DNS rebinding simulation, metadata addresses, path traversal, symlink escape, malicious YAML, evidence-size limits, forged signatures, future timestamps, secret-shaped diagnostics, and prohibited operation source scan.

- [ ] **Step 6: Implement failure injection**

For every network provider, inject timeout, connection reset, 429, 502, 503, 504, 401, 403, malformed JSON, partial response, oversized response, and cancellation. Assert retry and final evidence state.

- [ ] **Step 7: Run kind integration**

Deploy the sample service and collector to kind, wait for real rollout, emit traffic, run post_deployment, then deploy a failing image and assert the expected gate IDs fail.

- [ ] **Step 8: Add CI separation**

Fast unit and contract tests remain required on every pull request. E2E runs on pull requests touching production packages and nightly. Azure live compatibility runs manually or on a protected schedule with OIDC and read-only test resources.

- [ ] **Step 9: Run the complete suite**

Run:

~~~bash
npm run ci
npm run test:e2e
npm run test:security
~~~

Expected: all suites pass and failing scenarios fail only the intended gates.

- [ ] **Step 10: Commit**

~~~bash
git add tests docker .github/workflows/e2e.yml package.json package-lock.json
git commit -m "test: validate end-to-end gate behavior"
~~~

---

### Task 32: Add performance budgets, mutation tests, and release packaging

**Files:**
- Create: tests/performance/execution.test.ts
- Create: tests/property/decisions.test.ts
- Create: tests/property/interpolation.test.ts
- Create: tests/property/redaction.test.ts
- Create: tests/property/units.test.ts
- Create: stryker.config.json
- Create: rollup.config.js
- Create: scripts/verify-bundle.ts
- Create: scripts/verify-read-only.ts
- Create: .github/workflows/release.yml
- Modify: package.json
- Modify: README.md
- Modify: SECURITY.md
- Create: CONTRIBUTING.md

**Interfaces:**
- Consumes: completed product and all tests.
- Produces: reproducible Action bundle, CLI package, security attestations, and contributor release checks.

- [ ] **Step 1: Add property-test dependency**

Run:

~~~bash
npm install --save-dev --save-exact fast-check @stryker-mutator/core @stryker-mutator/vitest-runner
~~~

- [ ] **Step 2: Implement property tests**

Generate valid assertion boundaries, unit conversions, decision-result permutations, environment maps, and secret-bearing nested values. Assert aggregation is order-independent, interpolation never evaluates syntax other than ${NAME}, and redaction never preserves known secret values.

- [ ] **Step 3: Configure mutation testing**

Target decision aggregation, assertion comparisons, unit conversion, freshness, interpolation, and redaction. Set an initial required mutation score of 85 percent and break the build below it.

- [ ] **Step 4: Add performance tests**

Using fake providers, assert 200 gates plan under 250 milliseconds, report under 500 milliseconds, memory stays under the configured response plus report limits, identical evidence requests execute once, and provider concurrency never exceeds four.

- [ ] **Step 5: Verify read-only source**

The verification script parses production imports and API method references. It fails on child_process, shell execution, SSH/WinRM clients, Kubernetes mutation methods, Azure create/update/delete methods, and traffic mutation methods.

- [ ] **Step 6: Verify the Action bundle**

Assert action.yml points to dist/index.js, node24 is selected, dist exists, source map exists, production imports are bundled, and the bundle contains no absolute development paths.

- [ ] **Step 7: Implement release workflow**

On an explicitly approved release event, run the full CI, E2E, security, mutation, performance, bundle, and read-only checks; generate an SBOM and provenance attestation; build the CLI package; and publish immutable release artifacts. Marketplace metadata remains sourced from action.yml.

- [ ] **Step 8: Write contribution and security guidance**

CONTRIBUTING.md explains adding providers, gates, assertions, fixtures, and docs. SECURITY.md documents reporting, secret handling, threat boundaries, supported release artifacts, and the no-backend/no-mutation guarantee.

- [ ] **Step 9: Run final verification**

Run:

~~~bash
npm ci
npm run ci
npm run test:e2e
npm run test:security
npm run test:property
npm run test:mutation
npm run test:performance
npm run verify:bundle
npm run verify:read-only
git diff --exit-code
~~~

Expected: every command passes, generated artifacts are current, and the worktree is clean.

- [ ] **Step 10: Commit**

~~~bash
git add tests stryker.config.json rollup.config.js scripts .github/workflows/release.yml package.json package-lock.json README.md SECURITY.md CONTRIBUTING.md
git commit -m "build: harden and package observability gate"
~~~

---

## Cross-task acceptance matrix

| Design requirement | Owning tasks |
| --- | --- |
| One YAML, two phases | 3–5, 26, 28–29 |
| Shared Action and CLI engine | 26, 28, 29 |
| Complete 86-gate catalogue | 18–25 |
| Kubernetes and AKS | 15, 22, 31 |
| Azure Container Apps | 16, 23, 31 |
| Azure VM | 16, 24, 31 |
| Linux and Windows VM | 17, 24, 31 |
| Prometheus or Mimir | 11 |
| Loki and Tempo | 12 |
| Grafana dashboard, alerts, and SLO | 13 |
| SARIF, OTLP, deployment, synthetic, and incident evidence | 14 |
| Missing and stale evidence semantics | 6, 8, 11–14 |
| Baseline comparison | 21 |
| Read-only and no backend | 10, 15–17, 24, 32 |
| Security and SSRF protection | 3, 10, 14, 31–32 |
| Deterministic decisions | 7–9, 26 |
| JSON, Markdown, JUnit, SARIF | 27 |
| GitHub checks, summary, annotations, and outputs | 29 |
| Cancellation | 10, 26–29 |
| Documentation generated from source | 30 |
| E2E and release proof | 31–32 |

## Completion definition

Implementation is complete only when:

- Every implementation deliverable has validation evidence; commits remain user-authorized.
- npm run ci passes from a clean checkout.
- All 86 reference gate IDs resolve and their definitions validate.
- Runnable offline and authenticated workflow examples exercise both phases through CLI and
  Action composition. The exhaustive reference catalogue requires workload-specific acquisition inputs.
- Passing scenarios pass and failure-injection scenarios fail safely.
- Missing evidence never becomes a synthetic healthy value.
- Runtime, attestation, and telemetry identity disagreement blocks release.
- Report formats and Action outputs agree on the final decision.
- No production dependency or source path enables mutation, shell, SSH, or WinRM.
- Documentation and generated artifacts are current.
- The full security, property, mutation, performance, and E2E suites pass.
- The worktree is clean after rebuilding all generated files.

## Gate ownership ledger

This ledger is the plan-level completeness check. Task 25 enforces the same mapping
against the reference YAML so a future policy edit cannot add an unimplemented gate
silently.

| Phase | Gate ID | Gate type | Implementation owner |
| --- | --- | --- | --- |
| pre_deployment | readiness.policy | policy.self_check | Task 18 |
| pre_deployment | readiness.identity | identity.contract | Task 18 |
| pre_deployment | readiness.owner | asset.metadata | Task 18 |
| pre_deployment | readiness.runbook | asset.url | Task 18 |
| pre_deployment | readiness.dashboard | grafana.dashboard | Task 18 |
| pre_deployment | readiness.alert-rules | grafana.alert_rules | Task 18 |
| pre_deployment | readiness.alert-routing | grafana.notification_policy | Task 18 |
| pre_deployment | readiness.slo | grafana.slo_definition | Task 18 |
| pre_deployment | readiness.gate-queries | telemetry.query_validation | Task 18 |
| pre_deployment | readiness.instrumentation-configuration | artifact.instrumentation_configuration | Task 18 |
| pre_deployment | readiness.static-instrumentation-analysis | evidence.sarif | Task 18 |
| pre_deployment | readiness.telemetry-contract-test | evidence.otlp_contract | Task 18 |
| pre_deployment | readiness.telemetry-routing | telemetry.pipeline_configuration | Task 18 |
| pre_deployment | readiness.synthetic-plan | synthetic.plan | Task 18 |
| pre_deployment | readiness.post-gate-coverage | policy.coverage | Task 18 |
| pre_deployment | risk.telemetry-backends | providers.health | Task 19 |
| pre_deployment | risk.current-health | metric.threshold | Task 19 |
| pre_deployment | risk.current-error-rate | metric.threshold | Task 19 |
| pre_deployment | risk.slo-status | grafana.slo_status | Task 19 |
| pre_deployment | risk.error-budget | grafana.error_budget | Task 19 |
| pre_deployment | risk.burn-rate | grafana.burn_rate | Task 19 |
| pre_deployment | risk.active-alerts | grafana.alert_state | Task 19 |
| pre_deployment | risk.active-incidents | evidence.incident_state | Task 19 |
| pre_deployment | risk.dependencies | dependency.health | Task 19 |
| pre_deployment | risk.collector-health | telemetry.collector_health | Task 19 |
| pre_deployment | risk.capacity-headroom | runtime.capacity | Task 19 |
| pre_deployment | risk.change-freeze | policy.change_window | Task 19 |
| pre_deployment | risk.concurrent-deployment | deployment.concurrency | Task 19 |
| pre_deployment | risk.cardinality-change | telemetry.cardinality_estimate | Task 19 |
| pre_deployment | risk.telemetry-volume | telemetry.volume_estimate | Task 19 |
| pre_deployment | kubernetes.manifest | kubernetes.manifest | Task 22 |
| pre_deployment | kubernetes.probes | kubernetes.probes | Task 22 |
| pre_deployment | kubernetes.resources | kubernetes.resources | Task 22 |
| pre_deployment | kubernetes.rollout-strategy | kubernetes.rollout_strategy | Task 22 |
| pre_deployment | azure-container-apps.configuration | azure_container_apps.configuration | Task 23 |
| pre_deployment | azure-container-apps.probes | azure_container_apps.probes | Task 23 |
| pre_deployment | vm.release-identity | vm.release_identity | Task 24 |
| pre_deployment | vm.service-definition | vm.service_definition | Task 24 |
| pre_deployment | vm.host-capacity | vm.capacity | Task 24 |
| post_deployment | workload.provisioned | runtime.provisioned | Task 20 |
| post_deployment | workload.ready | runtime.ready | Task 20 |
| post_deployment | workload.release | runtime.release_identity | Task 20 |
| post_deployment | release.traffic | metric.threshold | Task 20 |
| post_deployment | telemetry.metrics-presence | telemetry.presence | Task 20 |
| post_deployment | telemetry.logs-presence | telemetry.presence | Task 20 |
| post_deployment | telemetry.traces-presence | telemetry.presence | Task 20 |
| post_deployment | telemetry.freshness | telemetry.freshness | Task 20 |
| post_deployment | telemetry.contract | telemetry.contract | Task 20 |
| post_deployment | telemetry.identity-consistency | telemetry.identity_consistency | Task 20 |
| post_deployment | telemetry.trace-log-correlation | telemetry.correlation | Task 20 |
| post_deployment | telemetry.service-graph | telemetry.service_graph | Task 20 |
| post_deployment | telemetry.pipeline-health | telemetry.collector_health | Task 20 |
| post_deployment | release.error-rate | metric.threshold | Task 20 |
| post_deployment | release.latency | metric.threshold | Task 20 |
| post_deployment | release.availability | metric.threshold | Task 20 |
| post_deployment | release.throughput | metric.threshold | Task 20 |
| post_deployment | release.saturation | metric.multi_threshold | Task 20 |
| post_deployment | release.stability | runtime.stability | Task 20 |
| post_deployment | regression.error-rate | comparison.metric | Task 21 |
| post_deployment | regression.latency | comparison.metric | Task 21 |
| post_deployment | regression.availability | comparison.metric | Task 21 |
| post_deployment | regression.resource-usage | comparison.multi_metric | Task 21 |
| post_deployment | regression.dependency-latency | comparison.trace_metrics | Task 21 |
| post_deployment | regression.telemetry-volume | comparison.telemetry_volume | Task 21 |
| post_deployment | reliability.slo-status | grafana.slo_status | Task 21 |
| post_deployment | reliability.error-budget | grafana.error_budget | Task 21 |
| post_deployment | reliability.burn-rate | grafana.burn_rate | Task 21 |
| post_deployment | reliability.active-alerts | grafana.alert_state | Task 21 |
| post_deployment | dependency.health | dependency.health | Task 21 |
| post_deployment | synthetic.result | synthetic.result | Task 21 |
| post_deployment | public-endpoint.health | http.assertion | Task 21 |
| post_deployment | custom.business-kpi | metric.threshold | Task 21 |
| post_deployment | kubernetes.rollout | kubernetes.rollout_status | Task 22 |
| post_deployment | kubernetes.image | kubernetes.image_identity | Task 22 |
| post_deployment | kubernetes.pods | kubernetes.pod_health | Task 22 |
| post_deployment | kubernetes.events | kubernetes.events | Task 22 |
| post_deployment | azure-container-apps.revision | azure_container_apps.revision_status | Task 23 |
| post_deployment | azure-container-apps.image | azure_container_apps.image_identity | Task 23 |
| post_deployment | azure-container-apps.traffic | azure_container_apps.traffic | Task 23 |
| post_deployment | azure-container-apps.replica-health | azure_container_apps.replica_health | Task 23 |
| post_deployment | azure-vm.provisioning | azure_vm.instance_view | Task 24 |
| post_deployment | windows-vm.service | vm.service_health | Task 24 |
| post_deployment | linux-vm.service | vm.service_health | Task 24 |
| post_deployment | vm.release-marker | vm.release_marker | Task 24 |
| post_deployment | vm.host-health | vm.host_health | Task 24 |
| post_deployment | vm.telemetry-agent | vm.agent_health | Task 24 |

## Current official references used for implementation choices

- GitHub JavaScript Action guide: https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action
- GitHub Action metadata syntax: https://docs.github.com/en/actions/reference/workflows-and-actions/metadata-syntax
- GitHub Actions Toolkit: https://github.com/actions/toolkit
- Kubernetes JavaScript client: https://github.com/kubernetes-client/javascript
- Azure Container Apps JavaScript SDK: https://learn.microsoft.com/javascript/api/overview/azure/arm-appcontainers-readme
- Azure Identity credential chains: https://learn.microsoft.com/azure/developer/javascript/sdk/credential-chains
