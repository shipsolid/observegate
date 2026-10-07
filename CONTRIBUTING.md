# Contributing to ObserveGate

ObserveGate is a read-only decision engine. Changes must preserve deterministic decision semantics,
strict configuration, bounded evidence collection, redacted reporting, and the no-backend/no-mutation
boundary.

## Development setup

Use Node.js 24 and install exactly the locked dependency graph:

```bash
npm ci
npm run ci
```

Keep one logical change per commit. Do not commit credentials, provider payloads, generated coverage,
or `.stryker-tmp` contents.

## Adding a provider capability

1. Define a typed, normalized evidence contract under `packages/providers/src`.
2. Route network access through the guarded transport and enforce HTTPS, allowlists, timeouts,
   response limits, cancellation, and safe retries.
3. Return explicit `missing`, `stale`, `insufficient`, `invalid`, or `unavailable` evidence instead
   of synthesizing a healthy value.
4. Register resolution in the provider session without exposing credentials or raw query bodies.
5. Add happy-path, malformed-response, authorization, timeout, cancellation, and redaction tests.
6. Update `docs/providers.md` through the documentation generator when its source metadata changes.

Provider code may read state only. It must not call create, update, patch, delete, restart, scale, or
traffic-shift APIs.

## Adding a gate

1. Add the gate definition and factory under `packages/gates/src` with a stable type identifier.
2. Declare required provider capabilities and normalized evidence inputs.
3. Register the gate in the catalogue and evaluator composition.
4. Add it to the reference policy and ownership/contract tests when it is part of the product
   catalogue.
5. Cover pass, blocking failure, insufficient evidence, provider error, advisory, and remediation
   behavior as applicable.
6. Regenerate the gate catalogue with `npm run docs:generate`.

Gate evaluation must be pure with respect to external systems. Evidence collection belongs in
providers; decision aggregation belongs in core.

## Adding an assertion

1. Extend the discriminated assertion types and strict configuration schema.
2. Implement the comparison in `packages/core/src/assertions` with explicit unit compatibility.
3. Add boundary tests for equality, failure, invalid input, and the full result/diagnostic contract.
4. Add property cases when the assertion has a meaningful invariant.
5. Include the comparison in `stryker.config.json` when it affects blocking decisions.

Never coerce incompatible units or turn absent, non-finite, or malformed evidence into zero.

## Fixtures and end-to-end scenarios

- Put reusable policy/evidence inputs in `fixtures/`; keep them synthetic and secret-free.
- Put cross-package scenarios in `tests/end-to-end`, provider failure cases in
  `tests/failure-injection`, and opt-in live compatibility checks in `tests/integration`.
- Extend the fake observability stack rather than contacting production services from default tests.
- Add one passing path and one expected-failure path for every new externally visible behavior.

## Documentation

Edit the metadata or source document that owns a generated section, then run:

```bash
npm run docs:generate
git diff --exit-code docs/configuration.md docs/gates.md docs/providers.md docs/errors.md
```

Document public configuration, evidence semantics, permissions, limits, failure classification, and
validation commands. Do not duplicate generated catalogue tables by hand.

## Required validation

Run the checks proportionate to the change; before release, all commands below must pass:

```bash
npm run ci
npm run test:e2e
npm run test:security
npm run test:property
npm run test:mutation
npm run test:performance
npm run bundle
npm run verify:bundle
npm run verify:read-only
git diff --exit-code
```

Changes to the checked-in Action must leave `dist/index.js` and its source map current. Release
artifacts are built only by the manually approved release workflow from an existing tag and draft
release. Before releasing, enable immutable releases for the repository and configure the protected
`release` environment with a `RELEASE_SETTINGS_TOKEN` secret. That fine-grained token needs only
repository Administration read permission and is used solely to verify the immutable-release
setting; publication uses the workflow's short-lived token. Release tags must be annotated semantic
version tags matching `package.json`.
