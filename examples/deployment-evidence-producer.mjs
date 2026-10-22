import process from "node:process";
import { Buffer } from "node:buffer";
import { createPrivateKey, createPublicKey, sign, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function validateReleaseInputs(releaseId, artifactDigest, imageRepository) {
  if (
    typeof releaseId !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$/.test(releaseId)
  )
    throw new Error("Release ID must be a Kubernetes label value of 1–63 safe characters");
  if (typeof artifactDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(artifactDigest))
    throw new Error("Image digest must be sha256 followed by 64 lowercase hexadecimal digits");
  if (imageRepository !== undefined && !/^[a-z0-9][a-z0-9./:_-]*$/.test(imageRepository))
    throw new Error("Image repository must be a registry/repository path without a tag or digest");
}

export function produceDeploymentEvidence(options) {
  validateReleaseInputs(options.releaseId, options.artifactDigest);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(options.commit))
    throw new Error("Commit must be a full hexadecimal Git object ID");
  for (const field of [
    "kid",
    "issuer",
    "audience",
    "subject",
    "target",
    "deploymentId",
    "workflowIdentity"
  ])
    if (
      typeof options[field] !== "string" ||
      options[field].length === 0 ||
      /[\r\n]/.test(options[field])
    )
      throw new Error(`Missing or invalid ${field}`);
  const now = options.now ?? Date.now();
  const deployedAt = Date.parse(options.deployedAt);
  if (!Number.isFinite(deployedAt) || deployedAt > now || now - deployedAt > 60 * 60 * 1000)
    throw new Error("Deployment completion time must precede issuance and be at most one hour old");
  const key = createPrivateKey(options.privateKeyPem);
  if (key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails.modulusLength < 2048)
    throw new Error("Signing key must be RSA with at least 2048 bits");
  const keys = options.publicJwks?.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 32)
    throw new Error("Trusted public JWKS must contain 1–32 public verification keys");
  const matching = keys.filter((candidate) => candidate.kid === options.kid);
  if (matching.length !== 1)
    throw new Error("Trusted public JWKS must have exactly one matching key ID");
  for (const candidate of keys)
    if (
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => candidate[field] !== undefined)
    )
      throw new Error("Trusted public JWKS must not contain private or symmetric key material");
  const publicKey = matching[0];
  if (
    publicKey.kty !== "RSA" ||
    (publicKey.alg !== undefined && publicKey.alg !== "RS256") ||
    (publicKey.use !== undefined && publicKey.use !== "sig") ||
    (publicKey.key_ops !== undefined &&
      (!Array.isArray(publicKey.key_ops) || !publicKey.key_ops.includes("verify")))
  )
    throw new Error("Trusted key must permit RS256 signature verification");
  const trusted = createPublicKey({ key: publicKey, format: "jwk" }).export({
    type: "spki",
    format: "der"
  });
  const actual = createPublicKey(key).export({ type: "spki", format: "der" });
  if (trusted.length !== actual.length || !timingSafeEqual(trusted, actual))
    throw new Error("Private signing key does not match the independently trusted public key");
  const issued = Math.floor(now / 1000);
  const payload = {
    iss: options.issuer,
    aud: options.audience,
    sub: options.subject,
    target: options.target,
    deploymentId: options.deploymentId,
    commit: options.commit,
    releaseId: options.releaseId,
    artifactDigest: options.artifactDigest,
    ...(typeof options.previousReleaseId === "string" && options.previousReleaseId !== "none"
      ? { previousReleaseId: options.previousReleaseId }
      : {}),
    deployedAt: new Date(deployedAt).toISOString(),
    workflowIdentity: options.workflowIdentity,
    iat: issued,
    exp: issued + 1800
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const message = `${encode({ alg: "RS256", typ: "JWT", kid: options.kid })}.${encode(payload)}`;
  return `${message}.${sign("RSA-SHA256", Buffer.from(message), key).toString("base64url")}`;
}

export async function verifyDeploymentEvidence(compact, verifier, expected, deploymentId) {
  const evidence = await verifier.verify(compact, { ...expected, deploymentId });
  if (evidence.deploymentId !== deploymentId)
    throw new Error("Signed deployment ID does not match the current deployment");
  return evidence;
}

async function main() {
  const env = process.env;
  validateReleaseInputs(env.RELEASE_ID, env.IMAGE_DIGEST, env.IMAGE_REPOSITORY);
  if (process.argv[2] === "validate") return;
  if (["prepare-readonly", "prepare-deploy"].includes(process.argv[2])) {
    const { parse } = await import("yaml");
    let config;
    try {
      config = parse(env.KUBECONFIG_CONTENT ?? "");
    } catch {
      throw new Error("Kubeconfig is invalid YAML");
    }
    const context = config?.contexts?.find(
      (entry) => entry.name === config["current-context"]
    )?.context;
    const user = config?.users?.find((entry) => entry.name === context?.user)?.user;
    const cluster = config?.clusters?.find((entry) => entry.name === context?.cluster)?.cluster;
    if (
      !context ||
      !user ||
      !cluster ||
      user.exec ||
      user["auth-provider"] ||
      cluster["insecure-skip-tls-verify"] ||
      !String(cluster.server).startsWith("https://") ||
      !(
        typeof user.token === "string" ||
        (typeof user["client-certificate-data"] === "string" &&
          typeof user["client-key-data"] === "string")
      )
    )
      throw new Error(
        "Kubeconfig must select a TLS-verified cluster and embedded token or client certificate credentials; exec authentication is unsupported"
      );
    if (!env.RUNNER_TEMP || !env.GITHUB_ENV)
      throw new Error("RUNNER_TEMP and GITHUB_ENV are required");
    const role = process.argv[2] === "prepare-readonly" ? "readonly" : "deploy";
    const path = `${env.RUNNER_TEMP}/observegate-${role}-kubeconfig`;
    await writeFile(path, env.KUBECONFIG_CONTENT, { mode: 0o600 });
    await appendFile(env.GITHUB_ENV, `KUBECONFIG=${path}\n`);
    await mkdir(".observegate-trust", { recursive: true, mode: 0o700 });
    let publicJwks;
    try {
      publicJwks = JSON.parse(env.PUBLIC_JWKS_JSON ?? "null");
    } catch {
      throw new Error("Protected public JWKS is invalid JSON");
    }
    if (!Array.isArray(publicJwks?.keys)) throw new Error("Protected PUBLIC_JWKS_JSON is required");
    await writeFile(".observegate-trust/jwks.json", JSON.stringify(publicJwks), { mode: 0o600 });
    return;
  }
  if (process.argv[2] !== "sign")
    throw new Error("Usage: node examples/deployment-evidence-producer.mjs validate|sign");
  if (env.WORKFLOW_IDENTITY !== env.EXPECTED_WORKFLOW_IDENTITY)
    throw new Error("Workflow identity must match the protected environment's expected workflow");
  const compact = produceDeploymentEvidence({
    privateKeyPem: env.SIGNING_PRIVATE_KEY_PEM,
    publicJwks: JSON.parse(await readFile(env.PUBLIC_JWKS_FILE, "utf8")),
    kid: env.SIGNING_KEY_ID,
    issuer: env.EVIDENCE_ISSUER,
    audience: "observegate-example",
    subject: env.EVIDENCE_SUBJECT,
    target: env.TARGET_ID,
    deploymentId: env.DEPLOYMENT_ID,
    commit: env.COMMIT_SHA,
    releaseId: env.RELEASE_ID,
    artifactDigest: env.IMAGE_DIGEST,
    previousReleaseId: env.PREVIOUS_RELEASE_ID,
    deployedAt: env.DEPLOYED_AT,
    workflowIdentity: env.WORKFLOW_IDENTITY
  });
  if (!env.EVIDENCE_OUTPUT) throw new Error("EVIDENCE_OUTPUT is required");
  await writeFile(env.EVIDENCE_OUTPUT, `${compact}\n`, { mode: 0o600, flag: "wx" });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(`Deployment evidence producer: ${error.message}\n`);
    process.exitCode = 1;
  });
