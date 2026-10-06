# Deployment evidence

Deployment evidence binds a workflow run to the candidate deployed into a target. ObserveGate
accepts compact JWS attestations signed with `RS256` or `ES256`; unsigned JSON and symmetric shared
secrets are not accepted as deployment attestations.

## Required claims

- Issuer and audience.
- Repository and workflow identity.
- Commit SHA, artifact/image digest, release ID, deployment ID, and target ID.
- Previous release ID when known.
- Deployment completion time, issued-at time, and expiry.

The verifier checks expected identity, allowed algorithm, key ID, signature, bounded clock skew,
freshness, issuer/audience, and workflow provenance. JWKS retrieval uses the guarded HTTPS transport
and the same SSRF/response-size controls as providers.

## Producer responsibilities

The deployment job owns mutation and creates the attestation only after deployment succeeds. Store
the compact JWS as a workflow artifact, transfer it to the post-deployment job, and configure its
workspace-local path. Rotate asymmetric signing keys through the organization identity system; do
not place private keys in the policy or reports.

## Failure behavior

Forged signatures, future timestamps, expired attestations, digest mismatches, and wrong workflow
identity are blocking evidence failures. Provider or key-resolution failures are execution errors.
