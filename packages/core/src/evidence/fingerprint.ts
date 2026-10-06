import { createHash } from "node:crypto";
import type { EvidenceRequest } from "./types.js";

const sensitiveKeyPattern = /authorization|token|password|secret|cookie|api[_-]?key|credential/iu;

function normalizeQuery(query: string): string {
  return query
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/\s*([()[\]{},+*/=<>!-])\s*/gu, "$1");
}

function canonicalize(value: unknown, key?: string): unknown {
  if (key !== undefined && sensitiveKeyPattern.test(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([childKey, item]) => [childKey, canonicalize(item, childKey)])
    );
  }
  return value;
}

export function stableFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

export function fingerprintEvidenceRequest(request: EvidenceRequest): string {
  return stableFingerprint({
    ...request,
    ...(request.query === undefined ? {} : { query: normalizeQuery(request.query) }),
    expectedValueType: undefined
  });
}

export function fingerprintQuery(query: string): string {
  return stableFingerprint(normalizeQuery(query));
}
