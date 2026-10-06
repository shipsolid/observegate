import { GateError } from "@observability-gate/core";

export interface ExpectedProvenance {
  readonly commit: string;
  readonly workflow: string;
}

export function validateProvenance(value: unknown, expected: ExpectedProvenance): void {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).commit !== expected.commit ||
    (value as Record<string, unknown>).workflow !== expected.workflow
  ) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Evidence provenance does not match the workflow and commit",
      retryable: false
    });
  }
}
