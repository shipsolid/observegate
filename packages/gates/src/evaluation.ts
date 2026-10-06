import {
  GateError,
  stableFingerprint,
  type AssertionResult,
  type Evidence,
  type Phase,
  type ProviderRequirement
} from "@observability-gate/core";
import type { GateTypeDefinition } from "./catalog/types.js";

export type GateDefinitionRecord = Readonly<Record<string, unknown>>;
export type EvidenceRecord = Readonly<Record<string, unknown>>;

export function record(value: unknown): EvidenceRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as EvidenceRecord)
    : undefined;
}

export function parseGateDefinition(input: unknown): GateDefinitionRecord {
  const value = record(input);
  if (value === undefined) {
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage: "Gate definition must be an object",
      retryable: false
    });
  }
  return value;
}

export function assertion(
  name: string,
  passed: boolean,
  message: string,
  observed?: unknown,
  expected?: unknown
): AssertionResult {
  return Object.freeze({
    assertion: name,
    status: passed ? "passed" : "failed",
    message,
    ...(observed === undefined ? {} : { observed }),
    ...(expected === undefined ? {} : { expected })
  });
}

export function evidenceValue(evidence: readonly Evidence<unknown>[]): EvidenceRecord {
  const value = record(evidence[0]?.value);
  if (value === undefined) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Gate evidence value must be an object",
      retryable: false
    });
  }
  return value;
}

export function createEvidenceGate(options: {
  readonly type: string;
  readonly description: string;
  readonly phases: readonly Phase[];
  readonly providerRequirements?: readonly ProviderRequirement[];
  readonly evaluate: (
    definition: GateDefinitionRecord,
    value: EvidenceRecord,
    evidence: readonly Evidence<unknown>[]
  ) => readonly AssertionResult[];
}): GateTypeDefinition<GateDefinitionRecord, unknown> {
  return {
    type: options.type,
    description: options.description,
    supportedPhases: options.phases,
    providerRequirements: options.providerRequirements ?? [],
    parseDefinition: parseGateDefinition,
    async acquire(definition, context) {
      if (context.resolveEvidence !== undefined) {
        return context.resolveEvidence(options.type, definition, context);
      }
      const embedded = definition.evidence;
      if (Array.isArray(embedded)) return embedded as readonly Evidence<unknown>[];
      const acquiredAt = context.clock().toISOString();
      return [
        Object.freeze({
          id: stableFingerprint({ type: options.type, target: context.targetId, acquiredAt }),
          kind: options.type,
          state: "valid",
          source: Object.freeze({ provider: "policy", capability: options.type }),
          target: context.targetId,
          acquiredAt,
          value: record(definition.value) ?? definition,
          diagnostics: Object.freeze([])
        })
      ];
    },
    evaluate(definition, evidence) {
      return options.evaluate(definition, evidenceValue(evidence), evidence);
    }
  };
}

export function booleanField(
  value: EvidenceRecord,
  field: string,
  message: string
): AssertionResult {
  return assertion(field, value[field] === true, message, value[field], true);
}
