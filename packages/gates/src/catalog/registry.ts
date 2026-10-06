import {
  GateError,
  type AssertionResult,
  type Evidence,
  type GateCatalogMetadata,
  type GateTypeMetadata,
  type Phase
} from "@observability-gate/core";
import type { GateContext } from "../execution/context.js";
import type { GateTypeDefinition, ResolvedGateType } from "./types.js";

interface RegisteredGateType {
  readonly metadata: GateTypeMetadata;
  readonly description: string;
  readonly parseDefinition: (input: unknown) => unknown;
  readonly acquire: (
    definition: unknown,
    context: Parameters<ResolvedGateType["acquire"]>[0]
  ) => ReturnType<ResolvedGateType["acquire"]>;
  readonly evaluate: (
    definition: unknown,
    evidence: Parameters<ResolvedGateType["evaluate"]>[0],
    context: Parameters<ResolvedGateType["evaluate"]>[1]
  ) => ReturnType<ResolvedGateType["evaluate"]>;
}

export class GateCatalog {
  private readonly definitions = new Map<string, RegisteredGateType>();

  public register<TDefinition, TEvidence>(
    definition: GateTypeDefinition<TDefinition, TEvidence>
  ): this {
    if (this.definitions.has(definition.type)) {
      throw new GateError({
        code: "CONFIG_REFERENCE",
        safeMessage: `Gate type is already registered: ${definition.type}`,
        retryable: false
      });
    }

    const metadata: GateTypeMetadata = Object.freeze({
      type: definition.type,
      supportedPhases: Object.freeze([...definition.supportedPhases]),
      providerRequirements: Object.freeze(
        definition.providerRequirements.map((requirement) => Object.freeze({ ...requirement }))
      )
    });
    const registered: RegisteredGateType = Object.freeze({
      metadata,
      description: definition.description,
      parseDefinition: (input: unknown) => definition.parseDefinition(input),
      acquire: async (parsed: unknown, context: GateContext) =>
        definition.acquire(parsed as TDefinition, context) as Promise<
          readonly import("@observability-gate/core").Evidence<unknown>[]
        >,
      evaluate: (
        parsed: unknown,
        parsedEvidence: readonly Evidence<unknown>[],
        context: GateContext
      ): readonly AssertionResult[] =>
        definition.evaluate(
          parsed as TDefinition,
          parsedEvidence as readonly import("@observability-gate/core").Evidence<TEvidence>[],
          context
        )
    });
    this.definitions.set(definition.type, registered);
    return this;
  }

  public require(type: string, phase: Phase, input: unknown): ResolvedGateType {
    const registered = this.definitions.get(type);
    if (registered === undefined) {
      throw new GateError({
        code: "CAPABILITY_UNSUPPORTED",
        safeMessage: `Gate type is not registered: ${type}`,
        retryable: false
      });
    }
    if (!registered.metadata.supportedPhases.includes(phase)) {
      throw new GateError({
        code: "CAPABILITY_UNSUPPORTED",
        safeMessage: `Gate type ${type} does not support phase ${phase}.`,
        retryable: false
      });
    }

    const parsed = registered.parseDefinition(input);
    return Object.freeze({
      metadata: registered.metadata,
      definition: parsed,
      acquire: (context: Parameters<ResolvedGateType["acquire"]>[0]) =>
        registered.acquire(parsed, context),
      evaluate: (
        evidence: Parameters<ResolvedGateType["evaluate"]>[0],
        context: Parameters<ResolvedGateType["evaluate"]>[1]
      ) => registered.evaluate(parsed, evidence, context)
    });
  }

  public metadata(): GateCatalogMetadata {
    return Object.freeze(
      Object.fromEntries(
        [...this.definitions.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([type, definition]) => [type, definition.metadata])
      )
    );
  }
}
