import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { CompactDeploymentVerifier } from "../../packages/providers/src/index.js";
import { parsePolicy, parseYaml } from "../../packages/config/src/index.js";
import { produceDeploymentEvidence, verifyDeploymentEvidence } from "../../examples/deployment-evidence-producer.mjs";

const now = Date.parse("2026-10-22T08:00:00Z");
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: "jwk" }), kid: "release-key", use: "sig", alg: "RS256" };
const options = {
  privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicJwks: { keys: [key] }, kid: "release-key", issuer: "https://releases.example.test", audience: "observegate-example", subject: "repo:shipsolid/observegate:environment:production", target: "aks-checkout", deploymentId: "run-123", commit: "a".repeat(40), releaseId: "release-v2", artifactDigest: `sha256:${"b".repeat(64)}`, previousReleaseId: "release-v1", deployedAt: new Date(now - 30_000).toISOString(), workflowIdentity: "shipsolid/observegate/.github/workflows/deploy.yml@refs/heads/main", now
};
const expected = { target: options.target, commit: options.commit, releaseId: options.releaseId, artifactDigest: options.artifactDigest };
function verifier() {
  return new CompactDeploymentVerifier({ trustedIssuer: options.issuer, audience: options.audience, expectedWorkflowIdentity: options.workflowIdentity, keyResolver: async () => key, clock: () => now });
}

describe("reproducible deployment workflow example", () => {
  it("produces compact asymmetric evidence accepted by the real verifier", async () => {
    const compact = produceDeploymentEvidence(options);
    await expect(verifier().verify(compact, expected)).resolves.toMatchObject({ deploymentId: options.deploymentId, previousReleaseId: "release-v1", workflowIdentity: options.workflowIdentity });
    await expect(verifyDeploymentEvidence(compact, verifier(), expected, options.deploymentId)).resolves.toMatchObject({ target: options.target });
  });
  it("rejects tampering, wrong digest, wrong deployment and another signing key", async () => {
    const compact = produceDeploymentEvidence(options);
    const [header, body, signature] = compact.split(".");
    const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), deploymentId: "other" })).toString("base64url");
    await expect(verifier().verify(`${header}.${changed}.${signature}`, expected)).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    await expect(verifier().verify(compact, { ...expected, artifactDigest: `sha256:${"c".repeat(64)}` })).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    await expect(verifyDeploymentEvidence(compact, verifier(), expected, "other-run")).rejects.toThrow(/deployment/i);
    const unrelated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => produceDeploymentEvidence({ ...options, publicJwks: { keys: [{ ...unrelated.publicKey.export({ format: "jwk" }), kid: "release-key" }] } })).toThrow(/key/i);
  });
  it.each(["$(touch /tmp/observegate-injected)", "bad\nrelease", "release,extra=value"])("rejects unsafe release identifiers %s", (releaseId) => {
    expect(() => produceDeploymentEvidence({ ...options, releaseId })).toThrow(/release/i);
  });
  it("rejects invalid digest and pre-deployment attestation timestamps", () => {
    expect(() => produceDeploymentEvidence({ ...options, artifactDigest: "latest" })).toThrow(/digest/i);
    expect(() => produceDeploymentEvidence({ ...options, deployedAt: new Date(now + 30_000).toISOString() })).toThrow(/deployment/i);
  });
  it("contains a policy accepted by the public parser", async () => {
    expect(parsePolicy(await readFile("examples/workflow-policy.yml", "utf8")).metadata.name).toBe("checkout-workflow-example");
  });
  it("keeps dispatch input out of shell source and retains reports after failure", async () => {
    const workflow = parseYaml(await readFile("examples/workflows/pre-and-post.yml", "utf8")) as { jobs: Record<string, { steps: { name?: string; run?: string; if?: string; uses?: string }[] }> };
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
    for (const step of steps) if (step.run) expect(step.run).not.toMatch(/\$\{\{\s*inputs\./);
    expect(steps.filter((step) => step.uses === "./")).toHaveLength(2);
    for (const phase of ["pre-deployment", "post-deployment"]) expect(workflow.jobs[phase]?.steps.find((step) => step.name === "Upload gate reports")?.if).toBe("always()");
  });
});
