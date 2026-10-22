import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { withCancellation } from "./retry.js";
import { GateError } from "@observability-gate/core";

export type UrlKind = "provider" | "probe";

export interface UrlPolicyOptions {
  readonly providerOrigins: readonly string[];
  readonly probeHosts: readonly string[];
  readonly allowedPorts?: readonly number[];
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
}

function securityViolation(message: string): GateError {
  return new GateError({
    code: "SECURITY_POLICY",
    safeMessage: message,
    retryable: false
  });
}

function parseIpv4(address: string): readonly number[] | undefined {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return undefined;
  }
  return parts;
}

function isForbiddenIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (parts === undefined) {
    return true;
  }
  const [first = 0, second = 0] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isForbiddenIpv6(address: string): boolean {
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1).toLowerCase();
  if (normalized === "::" || normalized === "::1" || normalized.startsWith("ff")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const firstGroup = Number.parseInt(normalized.split(":")[0] ?? "", 16);
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true;
  if (normalized.startsWith("::ffff:")) {
    const groups = normalized.slice(7).split(":");
    const high = Number.parseInt(groups[0] ?? "", 16);
    const low = Number.parseInt(groups[1] ?? "", 16);
    return isForbiddenIpv4(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  // IPv4-compatible, translated and well-known NAT64 addresses can hide IPv4 destinations.
  return normalized.startsWith("::") || normalized.startsWith("64:ff9b:");
}

function isForbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isForbiddenIpv4(address);
  }
  if (family === 6) {
    return isForbiddenIpv6(address);
  }
  return true;
}

export class UrlPolicy {
  private readonly providerOrigins: ReadonlySet<string>;
  private readonly probeHosts: ReadonlySet<string>;
  private readonly allowedPorts: ReadonlySet<number>;
  private readonly resolveHostname: (hostname: string) => Promise<readonly string[]>;

  public constructor(options: UrlPolicyOptions) {
    this.providerOrigins = new Set(options.providerOrigins.map((origin) => new URL(origin).origin));
    this.probeHosts = new Set(options.probeHosts.map((host) => host.toLowerCase()));
    this.allowedPorts = new Set(options.allowedPorts ?? [443]);
    this.resolveHostname =
      options.resolve ??
      (async (hostname) =>
        (await lookup(hostname, { all: true, verbatim: true })).map((answer) => answer.address));
  }

  public async validate(input: string | URL, kind: UrlKind, signal?: AbortSignal): Promise<URL> {
    return (await this.resolve(input, kind, signal)).url;
  }

  public async resolve(
    input: string | URL,
    kind: UrlKind,
    signal?: AbortSignal
  ): Promise<{ readonly url: URL; readonly addresses: readonly string[] }> {
    let url: URL;
    try {
      url = new URL(input);
    } catch (cause) {
      throw new GateError({
        code: "SECURITY_POLICY",
        safeMessage: "Provider URL is invalid",
        retryable: false,
        cause
      });
    }

    if (url.protocol !== "https:") {
      throw securityViolation("Provider URL must use HTTPS");
    }
    if (url.username.length > 0 || url.password.length > 0) {
      throw securityViolation("Provider URL must not contain user information");
    }

    const port = url.port.length === 0 ? 443 : Number(url.port);
    if (!this.allowedPorts.has(port)) {
      throw securityViolation("Provider URL uses a disallowed port");
    }

    const hostname = url.hostname.replace(/^\[|\]$/gu, "").toLowerCase();
    const allowed =
      kind === "provider" ? this.providerOrigins.has(url.origin) : this.probeHosts.has(hostname);
    if (!allowed) {
      throw securityViolation("Provider URL host is not allowlisted");
    }

    let addresses: readonly string[];
    if (isIP(hostname) !== 0) {
      addresses = [hostname];
    } else {
      try {
        addresses =
          signal === undefined
            ? await this.resolveHostname(hostname)
            : await withCancellation(() => this.resolveHostname(hostname), signal);
      } catch (cause) {
        if (signal?.aborted) throw cause;
        throw new GateError({
          code: "PROVIDER_UNAVAILABLE",
          safeMessage: "Provider hostname could not be resolved",
          retryable: true,
          cause
        });
      }
    }

    if (addresses.length === 0) {
      throw new GateError({
        code: "PROVIDER_UNAVAILABLE",
        safeMessage: "Provider hostname returned no addresses",
        retryable: true
      });
    }
    if (addresses.some(isForbiddenAddress)) {
      throw securityViolation("Provider URL resolves to a forbidden network address");
    }

    return { url, addresses: Object.freeze([...addresses]) };
  }
}
