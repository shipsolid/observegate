import { GateError } from "@observability-gate/core";

export interface SarifFinding {
  readonly ruleId: string;
  readonly level: string;
  readonly message: string;
  readonly location?: { readonly path: string; readonly line?: number };
}

export interface SarifEvidence {
  readonly findings: readonly SarifFinding[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function invalid(message: string): never {
  throw new GateError({ code: "EVIDENCE_INVALID", safeMessage: message, retryable: false });
}

export function parseSarifEvidence(
  content: Buffer,
  options: { readonly acceptedRulePrefixes: readonly string[] }
): SarifEvidence {
  let payload: unknown;
  try {
    payload = JSON.parse(content.toString("utf8")) as unknown;
  } catch (cause) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "SARIF is not valid JSON",
      retryable: false,
      cause
    });
  }
  const root = record(payload);
  if (root?.version !== "2.1.0" || !Array.isArray(root.runs)) {
    return invalid("SARIF envelope is invalid");
  }
  const findings: SarifFinding[] = [];
  for (const rawRun of root.runs) {
    const run = record(rawRun);
    if (run === undefined || !Array.isArray(run.results)) return invalid("SARIF run is invalid");
    for (const rawResult of run.results) {
      const result = record(rawResult);
      const message = record(result?.message);
      if (
        result === undefined ||
        typeof result.ruleId !== "string" ||
        typeof result.level !== "string" ||
        typeof message?.text !== "string"
      ) {
        return invalid("SARIF result is invalid");
      }
      const ruleId = result.ruleId;
      if (!options.acceptedRulePrefixes.some((prefix) => ruleId.startsWith(prefix))) continue;
      const rawLocation = Array.isArray(result.locations) ? record(result.locations[0]) : undefined;
      const physical = record(rawLocation?.physicalLocation);
      const artifact = record(physical?.artifactLocation);
      const region = record(physical?.region);
      const path = typeof artifact?.uri === "string" ? artifact.uri : undefined;
      const line = typeof region?.startLine === "number" ? region.startLine : undefined;
      findings.push(
        Object.freeze({
          ruleId,
          level: result.level,
          message: message.text,
          ...(path === undefined
            ? {}
            : { location: Object.freeze({ path, ...(line === undefined ? {} : { line }) }) })
        })
      );
    }
  }
  return Object.freeze({ findings: Object.freeze(findings) });
}
