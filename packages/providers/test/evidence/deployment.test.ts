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
      iat: 1791273000,
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
