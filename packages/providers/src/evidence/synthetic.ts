import { GateError } from "@observability-gate/core";

export interface SyntheticResult {
  readonly name: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly durationMs: number;
  readonly timestamp?: string;
  readonly observedRelease?: string;
}

export interface SyntheticEvidence {
  readonly tests: readonly SyntheticResult[];
}

function invalid(message: string): never {
  throw new GateError({ code: "EVIDENCE_INVALID", safeMessage: message, retryable: false });
}

function attributes(value: string): Record<string, string> {
  return Object.fromEntries(
    [...value.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)="([^"]*)"/gu)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").replace(/&quot;/gu, '"').replace(/&amp;/gu, "&")
    ])
  );
}

export function parseSyntheticEvidence(content: Buffer): SyntheticEvidence {
  const text = content.toString("utf8").trim();
  if (text.startsWith("<")) {
    if (/<!DOCTYPE|<!ENTITY/iu.test(text)) {
      throw new GateError({
        code: "SECURITY_POLICY",
        safeMessage: "Synthetic XML entities and document types are forbidden",
        retryable: false
      });
    }
    const tests: SyntheticResult[] = [];
    for (const match of text.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gu)) {
      const attrs = attributes(match[1] ?? "");
      const body = match[2] ?? "";
      const durationSeconds = Number(attrs.time);
      if (attrs.name === undefined || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
        return invalid("JUnit synthetic testcase is invalid");
      }
      const status = /<failure\b/iu.test(body)
        ? "failed"
        : /<skipped\b/iu.test(body)
          ? "skipped"
          : "passed";
      tests.push(
        Object.freeze({
          name: attrs.name,
          status,
          durationMs: durationSeconds * 1000,
          ...(attrs.timestamp === undefined ? {} : { timestamp: attrs.timestamp }),
          ...(attrs["observed-release"] === undefined
            ? {}
            : { observedRelease: attrs["observed-release"] })
        })
      );
    }
    if (tests.length === 0) return invalid("JUnit synthetic evidence contains no testcases");
    return Object.freeze({ tests: Object.freeze(tests) });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return invalid("Synthetic evidence is neither valid JSON nor JUnit XML");
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    !Array.isArray((payload as { tests?: unknown }).tests)
  ) {
    return invalid("Synthetic JSON envelope is invalid");
  }
  const tests: SyntheticResult[] = [];
  for (const value of (payload as { tests: unknown[] }).tests) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return invalid("Synthetic test is invalid");
    const test = value as Record<string, unknown>;
    if (
      typeof test.name !== "string" ||
      !["passed", "failed", "skipped"].includes(String(test.status)) ||
      typeof test.durationMs !== "number" ||
      !Number.isFinite(test.durationMs)
    )
      return invalid("Synthetic test is invalid");
    tests.push(Object.freeze(test as unknown as SyntheticResult));
  }
  return Object.freeze({ tests: Object.freeze(tests) });
}
