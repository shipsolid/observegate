import type { Enforcement, Phase } from "./gates.js";

export interface ProviderRequirement {
  readonly provider: string;
  readonly capability: string;
  readonly required: boolean;
}

export interface GateTypeMetadata {
  readonly type: string;
  readonly description: string;
  readonly supportedPhases: readonly Phase[];
  readonly providerRequirements: readonly ProviderRequirement[];
  readonly conditionKeys: readonly string[];
  readonly assertionSchema: string;
  readonly supportsRemediation: boolean;
}

export type GateCatalogMetadata = Readonly<Record<string, GateTypeMetadata>>;

export interface PlannedGate {
  readonly index: number;
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly enforcement: Enforcement;
  readonly applicability: "applicable" | "skipped";
  readonly skipReason?: string;
  readonly timeoutMs: number;
  readonly providerRequirements: readonly ProviderRequirement[];
  readonly definition: Readonly<Record<string, unknown>>;
}

export interface ExecutionPlan {
  readonly phase: Phase;
  readonly targetId: string;
  readonly runtimeType: string;
  readonly gates: readonly PlannedGate[];
  readonly requiredProviders: readonly ProviderRequirement[];
  readonly deadlineMs: number;
}
