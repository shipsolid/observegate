import {
  CompactDeploymentVerifier,
  GuardedJwksKeyResolver,
  type DeploymentEvidence
} from "../evidence/deployment.js";
import type { MetricsTransport } from "../metrics/types.js";
import {
  activeRuntime,
  configuration,
  field,
  loadFiles,
  record,
  string,
  type Context,
  type ResolverBase
} from "./shared.js";

export async function verifiedDeployment(
  base: ResolverBase,
  transport: MetricsTransport,
  context: Context
): Promise<DeploymentEvidence> {
  const config = record(record(base.policy.providers.evidence).deployment),
    signature = record(config.signature),
    canonical = record(base.policy.identity.canonical),
    runtime = activeRuntime(base.policy);
  const issuer = field(signature, "trusted_issuer", base.environment),
    jwks = field(signature, "jwks_url", base.environment),
    workflow = field(signature, "workflow_identity", base.environment),
    audience = string(signature.audience);
  if (
    issuer === undefined ||
    jwks === undefined ||
    workflow === undefined ||
    audience === undefined
  )
    configuration(
      "Signed deployment evidence requires providers.evidence.deployment.signature trusted_issuer, jwks_url, workflow_identity (or their _env references), and audience"
    );
  const files = await loadFiles(base, { source: { provider: "deployment" } });
  const keys = new GuardedJwksKeyResolver({ jwksUrl: jwks, transport, signal: context.signal });
  const verifier = new CompactDeploymentVerifier({
    trustedIssuer: issuer,
    audience,
    expectedWorkflowIdentity: workflow,
    keyResolver: (kid) => keys.resolve(kid),
    clock: base.now,
    maximumClockSkewMs: base.maximumFutureSkewMs
  });
  const expected = record(runtime.expected),
    digest =
      field(expected, "artifact_digest", base.environment) ??
      field(expected, "image_digest", base.environment);
  if (digest === undefined)
    configuration(
      "Signed deployment evidence verification requires active runtime.expected artifact_digest or image_digest"
    );
  return verifier.verify(files[0].content.toString("utf8"), {
    target: context.targetId,
    releaseId: context.releaseId ?? String(canonical.release_id ?? ""),
    commit:
      field(record(base.policy.release.candidate), "commit", base.environment) ??
      String(canonical.release_id ?? ""),
    artifactDigest: digest
  });
}
