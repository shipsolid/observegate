import { createHash } from "node:crypto";
import type { EvidenceRequest } from "./types.js";

const sensitiveKeyPattern = /authorization|token|password|secret|cookie|api[_-]?key|credential/iu;
const queryPunctuation = new Set("()[]{},+*/=<>!-");

function normalizeQuery(query: string): string {
  let normalized = "";
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  let pendingWhitespace = false;

  for (const character of query.trim()) {
    if (quote !== undefined) {
      normalized += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      if (
        pendingWhitespace &&
        normalized.length > 0 &&
        !queryPunctuation.has(normalized.at(-1) ?? "")
      ) {
        normalized += " ";
      }
      pendingWhitespace = false;
      quote = character;
      normalized += character;
      continue;
    }

    if (/\s/u.test(character)) {
      pendingWhitespace = true;
      continue;
    }

    if (queryPunctuation.has(character)) {
      pendingWhitespace = false;
      normalized += character;
      continue;
    }

    if (
      pendingWhitespace &&
      normalized.length > 0 &&
      !queryPunctuation.has(normalized.at(-1) ?? "")
    ) {
      normalized += " ";
    }
    pendingWhitespace = false;
    normalized += character;
  }

  return normalized;
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
