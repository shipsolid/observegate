import { createPublicKey, verify, type JsonWebKeyInput } from "node:crypto";
import { GateError } from "@observability-gate/core";
import type { MetricsTransport } from "../metrics/types.js";
import type { TransportRequest } from "../transport/guarded-fetch.js";

export interface DeploymentEvidence {
  readonly issuer: string;
  readonly audience: string | readonly string[];
  readonly subject: string;
  readonly target: string;
  readonly deploymentId: string;
  readonly commit: string;
  readonly releaseId: string;
  readonly artifactDigest: string;
  readonly previousReleaseId?: string;
  readonly deployedAt: string;
  readonly workflowIdentity: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface CompactDeploymentVerifierOptions {
  readonly trustedIssuer: string;
  readonly audience: string;
  readonly expectedWorkflowIdentity: string;
  readonly keyResolver: (kid: string) => Promise<JsonWebKeyInput["key"]>;
  readonly clock?: () => number;
  readonly maximumClockSkewMs?: number;
  readonly maximumAgeMs?: number;
}

export interface ExpectedDeploymentEvidence {
  readonly target: string;
  readonly releaseId: string;
  readonly commit: string;
  readonly artifactDigest: string;
}

export interface GuardedJwksKeyResolverOptions {
  readonly jwksUrl: string;
  readonly transport: MetricsTransport;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class GuardedJwksKeyResolver {
  private readonly options: GuardedJwksKeyResolverOptions;
  private readonly cache = new Map<string, JsonWebKeyInput["key"]>();

  public constructor(options: GuardedJwksKeyResolverOptions) {
    this.options = options;
  }

  public async resolve(kid: string): Promise<JsonWebKeyInput["key"]> {
    const cached = this.cache.get(kid);
    if (cached !== undefined) return cached;
    const signal = this.options.signal ?? new AbortController().signal;
    const request: TransportRequest = {
      url: this.options.jwksUrl,
      kind: "provider",
      timeoutMs: this.options.timeoutMs ?? 5_000,
      maximumResponseBytes: 256 * 1024,
      retry: {
        attempts: 3,
        initialBackoffMs: 200,
        maximumBackoffMs: 2_000,
        retryStatuses: [429, 502, 503, 504]
      },
      signal
    };
    const payload = (await this.options.transport.request(request)).data;
    const envelope = record(payload);
    if (!Array.isArray(envelope?.keys) || envelope.keys.length > 32) {
      throw security("JWKS response is invalid or exceeds the key limit");
    }
    for (const value of envelope.keys) {
      const key = record(value);
      if (
        key === undefined ||
        typeof key.kid !== "string" ||
        (key.use !== undefined && key.use !== "sig") ||
        !["RSA", "EC"].includes(String(key.kty))
      ) {
        throw security("JWKS contains an invalid signing key");
      }
      this.cache.set(key.kid, key as JsonWebKeyInput["key"]);
    }
    const resolved = this.cache.get(kid);
    if (resolved === undefined) throw security("JWKS does not contain the requested signing key");
    return resolved;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function security(message: string, cause?: unknown): GateError {
  return new GateError({ code: "SECURITY_POLICY", safeMessage: message, retryable: false, cause });
}

function parsePart(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    const object = record(parsed);
    if (object === undefined) throw new Error("not an object");
    return object;
  } catch (cause) {
    throw security("Signed deployment evidence is malformed", cause);
  }
}

export class CompactDeploymentVerifier {
  private readonly options: CompactDeploymentVerifierOptions;
  private readonly clock: () => number;

  public constructor(options: CompactDeploymentVerifierOptions) {
    this.options = options;
    this.clock = options.clock ?? Date.now;
  }

  public async verify(
    compact: string,
    expected: ExpectedDeploymentEvidence
  ): Promise<DeploymentEvidence> {
    const parts = compact.trim().split(".");
    if (parts.length !== 3) throw security("Signed deployment evidence must be compact JWS");
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = parsePart(encodedHeader);
    if (!(["RS256", "ES256"] as const).includes(header.alg as "RS256" | "ES256")) {
      throw security("Signed deployment evidence uses a forbidden algorithm");
    }
    if (typeof header.kid !== "string" || header.kid.length === 0) {
      throw security("Signed deployment evidence is missing a key identifier");
    }
    const jwk = await this.options.keyResolver(header.kid);
    const key = record(jwk);
    if (
      key === undefined ||
      (header.alg === "RS256" ? key.kty !== "RSA" : key.kty !== "EC" || key.crv !== "P-256") ||
      (key.alg !== undefined && key.alg !== header.alg) ||
      (key.use !== undefined && key.use !== "sig") ||
      (key.key_ops !== undefined &&
        (!Array.isArray(key.key_ops) || !key.key_ops.includes("verify"))) ||
      ["d", "p", "q", "dp", "dq", "qi", "oth", "k"].some((field) => key[field] !== undefined)
    )
      throw security("Signed deployment evidence signing key violates algorithm policy");
    let valid: boolean;
    try {
      valid = verify(
        header.alg === "RS256" ? "RSA-SHA256" : "sha256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        {
          key: createPublicKey({ key: jwk, format: "jwk" }),
          ...(header.alg === "ES256" ? { dsaEncoding: "ieee-p1363" as const } : {})
        },
        Buffer.from(encodedSignature, "base64url")
      );
    } catch (cause) {
      throw security("Signed deployment evidence could not be verified", cause);
    }
    if (!valid) throw security("Signed deployment evidence signature is invalid");

    const payload = parsePart(encodedPayload);
    const audience = payload.aud;
    const audienceMatches =
      audience === this.options.audience ||
      (Array.isArray(audience) && audience.includes(this.options.audience));
    const requiredStrings = [
      "iss",
      "sub",
      "target",
      "deploymentId",
      "commit",
      "releaseId",
      "artifactDigest",
      "deployedAt",
      "workflowIdentity"
    ] as const;
    if (
      payload.iss !== this.options.trustedIssuer ||
      !audienceMatches ||
      requiredStrings.some(
        (key) => typeof payload[key] !== "string" || (payload[key] as string).length === 0
      ) ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.iat) ||
      !Number.isFinite(payload.exp) ||
      !Number.isFinite(new Date(payload.iat * 1000).getTime()) ||
      !Number.isFinite(new Date(payload.exp * 1000).getTime()) ||
      payload.workflowIdentity !== this.options.expectedWorkflowIdentity
    ) {
      throw security("Signed deployment evidence claims are invalid");
    }
    const nowSeconds = this.clock() / 1000;
    const skewSeconds = (this.options.maximumClockSkewMs ?? 5_000) / 1000;
    if (
      payload.exp <= payload.iat ||
      payload.exp < nowSeconds - skewSeconds ||
      payload.iat > nowSeconds + skewSeconds
    ) {
      throw security("Signed deployment evidence is expired or issued in the future");
    }
    if (
      payload.target !== expected.target ||
      payload.releaseId !== expected.releaseId ||
      payload.commit !== expected.commit ||
      payload.artifactDigest !== expected.artifactDigest
    ) {
      throw security("Signed deployment evidence does not match the expected deployment");
    }
    const deployedAt = Date.parse(payload.deployedAt as string);
    const maximumAgeMs = this.options.maximumAgeMs ?? 60 * 60 * 1000;
    if (
      !Number.isFinite(deployedAt) ||
      deployedAt > this.clock() + skewSeconds * 1000 ||
      this.clock() - deployedAt > maximumAgeMs + skewSeconds * 1000 ||
      deployedAt > (payload.iat + skewSeconds) * 1000 ||
      deployedAt > (payload.exp + skewSeconds) * 1000
    ) {
      throw security(
        "Signed deployment evidence has an invalid, stale, or out-of-order deployment time"
      );
    }
    return Object.freeze({
      issuer: payload.iss as string,
      audience: audience as string | readonly string[],
      subject: payload.sub as string,
      target: payload.target as string,
      deploymentId: payload.deploymentId as string,
      commit: payload.commit as string,
      releaseId: payload.releaseId as string,
      artifactDigest: payload.artifactDigest as string,
      ...(typeof payload.previousReleaseId === "string"
        ? { previousReleaseId: payload.previousReleaseId }
        : {}),
      deployedAt: new Date(payload.deployedAt as string).toISOString(),
      workflowIdentity: payload.workflowIdentity as string,
      issuedAt: new Date(payload.iat * 1000).toISOString(),
      expiresAt: new Date(payload.exp * 1000).toISOString()
    });
  }
}
