import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CompactDeploymentVerifier,
  GuardedJwksKeyResolver,
  type TransportRequest,
  type TransportResponse
} from "../../src/index.js";

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("CompactDeploymentVerifier", () => {
  it("verifies asymmetric signature, issuer, audience, workflow, expiry, and domain fields", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = encoded({ alg: "RS256", kid: "release-key" });
    const payload = {
      iss: "https://token.actions.githubusercontent.com",
      aud: "observegate",
      sub: "repo:shipsolid/observegate:environment:production",
      target: "prod-checkout",
      deploymentId: "deploy-123",
      commit: "abc123",
      releaseId: "2026.10.6",
      artifactDigest: `sha256:${createHash("sha256").update("image").digest("hex")}`,
      previousReleaseId: "2026.10.5",
      deployedAt: "2026-10-06T07:55:00.000Z",
      workflowIdentity: "shipsolid/observegate/.github/workflows/deploy.yml@refs/heads/main",
      iat: 1791273360,
      exp: 1791277200
    };
    const body = encoded(payload);
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString(
      "base64url"
    );
    const verifier = new CompactDeploymentVerifier({
      trustedIssuer: "https://token.actions.githubusercontent.com",
      audience: "observegate",
      expectedWorkflowIdentity:
        "shipsolid/observegate/.github/workflows/deploy.yml@refs/heads/main",
      clock: () => Date.parse("2026-10-06T08:00:00.000Z"),
      keyResolver: async (kid) => {
        expect(kid).toBe("release-key");
        return publicKey.export({ format: "jwk" });
      }
    });

    await expect(
      verifier.verify(`${header}.${body}.${signature}`, {
        target: "prod-checkout",
        releaseId: "2026.10.6",
        commit: "abc123",
        artifactDigest: payload.artifactDigest
      })
    ).resolves.toMatchObject({ deploymentId: "deploy-123", previousReleaseId: "2026.10.5" });
  });

  it.each(["none", "HS256"])("rejects %s signatures before key resolution", async (alg) => {
    const verifier = new CompactDeploymentVerifier({
      trustedIssuer: "issuer",
      audience: "audience",
      expectedWorkflowIdentity: "workflow",
      keyResolver: async () => {
        throw new Error("must not resolve");
      }
    });
    await expect(
      verifier.verify(`${encoded({ alg, kid: "key" })}.${encoded({})}.x`, {
        target: "target",
        releaseId: "release",
        commit: "commit",
        artifactDigest: "sha256:digest"
      })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });

  it("resolves signing keys only through the guarded provider transport", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = { ...publicKey.export({ format: "jwk" }), kid: "release-key", use: "sig" };
    const requests: TransportRequest[] = [];
    const transport = {
      request: async (request: TransportRequest): Promise<TransportResponse> => {
        requests.push(request);
        return { status: 200, data: { keys: [jwk] }, attempts: 1, headers: new Headers() };
      }
    };
    const resolver = new GuardedJwksKeyResolver({
      jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
      transport
    });

    await expect(resolver.resolve("release-key")).resolves.toMatchObject({ kid: "release-key" });
    expect(requests[0]).toMatchObject({ kind: "provider", maximumResponseBytes: 262_144 });
    expect(String(requests[0]?.url)).toBe("https://issuer.example.com/.well-known/jwks.json");
  });
});

describe("deployment JOSE and completion-time constraints", () => {
  const now = Date.parse("2026-10-06T08:00:00Z");
  const expected = {
    target: "target",
    releaseId: "release",
    commit: "commit",
    artifactDigest: "sha256:digest"
  };
  const claims = {
    iss: "issuer",
    aud: "audience",
    sub: "subject",
    workflowIdentity: "workflow",
    deploymentId: "deployment",
    ...expected,
    deployedAt: new Date(now - 60_000).toISOString(),
    iat: (now - 30_000) / 1000,
    exp: (now + 120_000) / 1000
  };
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  async function check(
    overrides: Record<string, unknown>,
    algorithm = "RS256",
    key = rsa,
    metadata: Record<string, unknown> = {}
  ) {
    const header = encoded({ alg: algorithm, kid: "key" });
    const body = encoded({ ...claims, ...overrides });
    const signature = sign("sha256", Buffer.from(`${header}.${body}`), {
      key: key.privateKey,
      ...(algorithm === "ES256" ? { dsaEncoding: "ieee-p1363" as const } : {})
    }).toString("base64url");
    const verifier = new CompactDeploymentVerifier({
      trustedIssuer: "issuer",
      audience: "audience",
      expectedWorkflowIdentity: "workflow",
      clock: () => now,
      keyResolver: async () => ({ ...key.publicKey.export({ format: "jwk" }), ...metadata })
    });
    return verifier.verify(`${header}.${body}.${signature}`, expected);
  }
  it.each([
    { deployedAt: new Date(now + 60_000).toISOString() },
    { deployedAt: new Date(now - 86_400_000).toISOString() },
    { iat: (now - 180_000) / 1000 },
    { deployedAt: new Date(now + 240_000).toISOString() },
    { iat: (now + 60_000) / 1000, exp: (now - 60_000) / 1000 },
    { exp: 1e100 }
  ])("rejects completion time outside token/current freshness bounds %s", async (overrides) => {
    await expect(check(overrides)).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });
  it("rejects ES256 signatures made with P-384", async () => {
    const key = generateKeyPairSync("ec", { namedCurve: "P-384" });
    await expect(check({}, "ES256", key)).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });
  it("rejects keys declaring another algorithm or non-verification use", async () => {
    await expect(check({}, "RS256", rsa, { alg: "RS512" })).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
    await expect(check({}, "RS256", rsa, { key_ops: ["encrypt"] })).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
  });
  it("accepts ES256 with a P-256 verification key", async () => {
    const key = generateKeyPairSync("ec", { namedCurve: "P-256" });
    await expect(
      check({}, "ES256", key, { alg: "ES256", key_ops: ["verify"] })
    ).resolves.toMatchObject({ deploymentId: "deployment" });
  });
});

describe("expected deployment run binding", () => {
  it("rejects a valid attestation replayed from another deployment ID", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const now = Date.now();
    const expected = {
      target: "app",
      releaseId: "release",
      commit: "commit",
      artifactDigest: "sha256:digest",
      deploymentId: "current-run"
    };
    const header = encoded({ alg: "RS256", kid: "key" });
    const body = encoded({
      ...expected,
      deploymentId: "previous-run",
      iss: "issuer",
      aud: "audience",
      sub: "subject",
      workflowIdentity: "workflow",
      deployedAt: new Date(now - 1000).toISOString(),
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 300
    });
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), privateKey).toString(
      "base64url"
    );
    const verifier = new CompactDeploymentVerifier({
      trustedIssuer: "issuer",
      audience: "audience",
      expectedWorkflowIdentity: "workflow",
      keyResolver: async () => publicKey.export({ format: "jwk" }),
      clock: () => now
    });
    await expect(verifier.verify(`${header}.${body}.${signature}`, expected)).rejects.toMatchObject(
      { code: "SECURITY_POLICY" }
    );
  });
});
