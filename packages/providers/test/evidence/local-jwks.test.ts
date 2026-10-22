import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "@observability-gate/core";
import { describe, expect, it } from "vitest";
import { SafeEvidenceFileLoader, GuardedJwksKeyResolver } from "../../src/index.js";
import { verifiedDeployment } from "../../src/resolvers/deployment.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKey = { ...pair.publicKey.export({ format: "jwk" }), kid: "key", use: "sig" };
const time = Date.now();
const expected = {
  target: "target",
  releaseId: "release",
  commit: "commit",
  artifactDigest: "sha256:digest",
  deploymentId: "run"
};
const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const header = encode({ alg: "RS256", kid: "key" });
const body = encode({
  ...expected,
  iss: "issuer",
  aud: "audience",
  sub: "subject",
  workflowIdentity: "workflow",
  deployedAt: new Date(time - 1000).toISOString(),
  iat: Math.floor(time / 1000),
  exp: Math.floor(time / 1000) + 300
});
const compact = `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), pair.privateKey).toString("base64url")}`;
const noNetwork = {
  request: async (): Promise<never> => {
    throw new Error("must use trusted local JWKS");
  }
};

async function check(keys: unknown[], path = "keys.json") {
  const root = await mkdtemp(join(tmpdir(), "observegate-jwks-"));
  try {
    await writeFile(join(root, "keys.json"), JSON.stringify({ keys }));
    await writeFile(join(root, "release.jws"), compact);
    return await verifiedDeployment(
      {
        policy: {
          identity: { canonical: { deployment_id: expected.deploymentId } },
          release: { candidate: { commit: expected.commit } },
          execution: { active_target: "target" },
          targets: {
            definitions: {
              target: { runtime: { expected: { image_digest: expected.artifactDigest } } }
            }
          },
          providers: {
            evidence: {
              deployment: {
                files: ["release.jws"],
                signature: {
                  trusted_issuer: "issuer",
                  audience: "audience",
                  workflow_identity: "workflow",
                  jwks_file: path
                }
              }
            }
          },
          observation: {},
          gates: {},
          reporting: {},
          security: {},
          limits: {}
        },
        environment: {},
        files: new SafeEvidenceFileLoader({ workspaceRoot: root }),
        now: () => time,
        maximumFutureSkewMs: 5000
      },
      noNetwork,
      {
        phase: "post_deployment",
        targetId: "target",
        releaseId: "release",
        evidenceStore: new EvidenceStore(),
        signal: new AbortController().signal,
        clock: () => new Date(time)
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("trusted local public JWKS", () => {
  it("verifies local signed evidence without any network request", async () => {
    await expect(check([publicKey])).resolves.toMatchObject({
      deploymentId: expected.deploymentId
    });
  });
  it("rejects paths outside the workspace", async () => {
    await expect(check([publicKey], "../keys.json")).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
  });
  it.each([
    { name: "private key", keys: [{ ...publicKey, d: "private" }] },
    { name: "symmetric key", keys: [{ kid: "key", kty: "oct", k: "secret" }] },
    { name: "duplicate identifiers", keys: [publicKey, { ...publicKey, n: "another-modulus" }] },
    {
      name: "too many keys",
      keys: Array.from({ length: 33 }, (_, index) => ({ ...publicKey, kid: String(index) }))
    }
  ])("rejects $name", async ({ keys }) => {
    await expect(check(keys)).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });
  it("applies the same private-key and duplicate restrictions to remote JWKS", async () => {
    const resolver = new GuardedJwksKeyResolver({
      jwksUrl: "https://issuer.example/jwks.json",
      transport: {
        request: async () => ({
          status: 200,
          data: { keys: [{ ...publicKey, d: "private" }] },
          attempts: 1,
          headers: new Headers()
        })
      }
    });
    await expect(resolver.resolve("key")).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });
});
