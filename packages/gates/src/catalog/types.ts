import type {
  AssertionResult,
  Evidence,
  GateTypeMetadata,
  Phase,
  ProviderRequirement
} from "@observability-gate/core";
import type { GateContext } from "../execution/context.js";

export interface GateTypeDefinition<TDefinition, TEvidence> {
  readonly type: string;
  readonly description: string;
  readonly supportedPhases: readonly Phase[];
  readonly providerRequirements: readonly ProviderRequirement[];
  readonly parseDefinition: (input: unknown) => TDefinition;
  readonly acquire: (
    definition: TDefinition,
    context: GateContext
  ) => Promise<readonly Evidence<TEvidence>[]>;
  readonly evaluate: (
    definition: TDefinition,
    evidence: readonly Evidence<TEvidence>[],
    context: GateContext
  ) => readonly AssertionResult[];
}

export interface ResolvedGateType {
  readonly metadata: GateTypeMetadata;
  readonly definition: unknown;
  readonly acquire: (context: GateContext) => Promise<readonly Evidence<unknown>[]>;
  readonly evaluate: (
    evidence: readonly Evidence<unknown>[],
    context: GateContext
  ) => readonly AssertionResult[];
}
