import {
  CompactDeploymentVerifier,
  GuardedJwksKeyResolver,
  parsePublicJwks,
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
    audience = string(signature.audience),
    jwksFile = string(signature.jwks_file);
  if (
    issuer === undefined ||
    (jwks === undefined && jwksFile === undefined) ||
    workflow === undefined ||
    audience === undefined
  )
    configuration(
      "Signed deployment evidence requires providers.evidence.deployment.signature trusted_issuer, jwks_url or jwks_file, workflow_identity (or their _env references), and audience"
    );
  const files = await loadFiles(base, { source: { provider: "deployment" } });
  if (jwks !== undefined && jwksFile !== undefined)
    configuration("Signed deployment evidence requires exactly one of jwks_url or jwks_file");
  let localKeys: ReturnType<typeof parsePublicJwks> | undefined;
  if (jwksFile !== undefined) {
    const trusted = await base.files.load({ path: jwksFile, blocking: true });
    if (trusted.content.byteLength > 256 * 1024) configuration("Trusted JWKS file exceeds the size limit");
    let payload: unknown;
    try { payload = JSON.parse(trusted.content.toString("utf8")); }
    catch { configuration("Trusted JWKS file is not valid JSON"); }
    localKeys = parsePublicJwks(payload);
  }
  const keys = jwks === undefined ? undefined : new GuardedJwksKeyResolver({ jwksUrl: jwks, transport, signal: context.signal });
  const verifier = new CompactDeploymentVerifier({
    trustedIssuer: issuer,
    audience,
    expectedWorkflowIdentity: workflow,
    keyResolver: async (kid) => {
      if (keys !== undefined) return keys.resolve(kid);
      return localKeys?.get(kid) ?? configuration("Trusted JWKS file does not contain the requested signing key");
    },
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
    ...(typeof canonical.deployment_id === "string" ? { deploymentId: canonical.deployment_id } : {}),
    target: context.targetId,
    releaseId: context.releaseId ?? String(canonical.release_id ?? ""),
    commit:
      field(record(base.policy.release.candidate), "commit", base.environment) ??
      String(canonical.release_id ?? ""),
    artifactDigest: digest
  });
}
