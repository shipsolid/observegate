import { GateError } from "@observability-gate/core";
import { SaxesParser } from "saxes";

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

function validateTests(values: readonly unknown[]): SyntheticEvidence {
  if (values.length === 0 || values.length > 10_000)
    return invalid("Synthetic evidence contains no tests or exceeds the test limit");
  const names = new Set<string>();
  const tests: SyntheticResult[] = [];
  for (const value of values) {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return invalid("Synthetic test is invalid");
    const test = value as Record<string, unknown>;
    if (
      typeof test.name !== "string" ||
      test.name.trim().length === 0 ||
      names.has(test.name) ||
      !["passed", "failed", "skipped"].includes(String(test.status)) ||
      typeof test.durationMs !== "number" ||
      !Number.isFinite(test.durationMs) ||
      test.durationMs < 0 ||
      (test.timestamp !== undefined &&
        (typeof test.timestamp !== "string" || !Number.isFinite(Date.parse(test.timestamp)))) ||
      (test.observedRelease !== undefined &&
        (typeof test.observedRelease !== "string" || test.observedRelease.length === 0)) ||
      Object.keys(test).some(
        (key) => !["name", "status", "durationMs", "timestamp", "observedRelease"].includes(key)
      )
    )
      return invalid("Synthetic test is invalid or has a duplicate name");
    names.add(test.name);
    tests.push(Object.freeze({ ...test } as unknown as SyntheticResult));
  }
  return Object.freeze({ tests: Object.freeze(tests) });
}

function parseJUnit(text: string): SyntheticEvidence {
  const parser = new SaxesParser({ xmlns: false });
  const elements: string[] = [];
  const tests: SyntheticResult[] = [];
  let current:
    | {
        name: string;
        status: "passed" | "failed" | "skipped";
        durationMs: number;
        timestamp?: string;
        observedRelease?: string;
      }
    | undefined;
  parser.on("doctype", () => {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "Synthetic XML entities and document types are forbidden",
      retryable: false
    });
  });
  parser.on("error", () => invalid("JUnit synthetic XML is malformed"));
  parser.on("opentag", (tag) => {
    const parent = elements.at(-1);
    if (elements.length >= 64) return invalid("JUnit synthetic XML exceeds the nesting limit");
    if (elements.length === 0 && !["testsuites", "testsuite"].includes(tag.name))
      return invalid("JUnit synthetic root is invalid");
    if (tag.name === "testcase") {
      if (parent !== "testsuite" || current !== undefined || tests.length >= 10_000)
        return invalid("JUnit synthetic testcase structure is invalid");
      const attrs = tag.attributes as Record<string, string>;
      const duration =
        attrs.time === undefined || attrs.time.trim().length === 0 ? NaN : Number(attrs.time);
      current = {
        name: attrs.name ?? "",
        status: "passed",
        durationMs: duration * 1000,
        ...(attrs.timestamp === undefined ? {} : { timestamp: attrs.timestamp }),
        ...(attrs["observed-release"] === undefined
          ? {}
          : { observedRelease: attrs["observed-release"] })
      };
    } else if (parent === "testcase" && current !== undefined) {
      if (tag.name === "failure" || tag.name === "error") current.status = "failed";
      else if (tag.name === "skipped" && current.status !== "failed") current.status = "skipped";
    }
    elements.push(tag.name);
  });
  parser.on("closetag", (tag) => {
    if (tag.name === "testcase" && current !== undefined) {
      tests.push(current);
      current = undefined;
    }
    elements.pop();
  });
  parser.write(text).close();
  return validateTests(tests);
}

export function parseSyntheticEvidence(content: Buffer): SyntheticEvidence {
  if (content.byteLength > 2 * 1024 * 1024)
    return invalid("Synthetic evidence exceeds the size limit");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(content).trim();
  } catch {
    return invalid("Synthetic evidence is not valid UTF-8");
  }
  if (text.startsWith("<")) return parseJUnit(text);
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return invalid("Synthetic evidence is neither valid JSON nor JUnit XML");
  }
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !Array.isArray((payload as { tests?: unknown }).tests) ||
    Object.keys(payload).some((key) => key !== "tests")
  )
    return invalid("Synthetic JSON envelope is invalid");
  return validateTests((payload as { tests: unknown[] }).tests);
}
