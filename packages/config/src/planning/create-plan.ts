import {
  GateError,
  parseByteSize,
  type Enforcement,
  type ExecutionPlan,
  type GateCatalogMetadata,
  type Phase,
  type PlannedGate,
  type ProviderRequirement
} from "@observability-gate/core";
import type { RawPolicy } from "../schema/policy.js";
import { evaluateConditions } from "./conditions.js";
import { collectProviders, validatePolicyReferences } from "./references.js";

export interface CreateExecutionPlanInput {
  readonly policy: RawPolicy;
  readonly phase: Phase;
  readonly catalog: GateCatalogMetadata;
}

const durationPattern = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u;
const durationMultipliers: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000
};

function parseDuration(value: string): number {
  const match = durationPattern.exec(value);
  const multiplier = match?.[2] === undefined ? undefined : durationMultipliers[match[2]];
  if (match?.[1] === undefined || multiplier === undefined) {
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage: `Invalid duration: ${value}`,
      retryable: false
    });
  }
  return Number(match[1]) * multiplier;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function deduplicateRequirements(
  requirements: readonly ProviderRequirement[]
): readonly ProviderRequirement[] {
  const merged = new Map<string, ProviderRequirement>();
  for (const requirement of requirements) {
    const key = `${requirement.provider}\u0000${requirement.capability}`;
    const existing = merged.get(key);
    merged.set(key, {
      ...requirement,
      required: requirement.required || existing?.required === true
    });
  }
  return Object.freeze([...merged.values()].map((item) => Object.freeze(item)));
}

function gateEnforcement(policy: RawPolicy, gateEnforcement: string | undefined): Enforcement {
  const enforcement = gateEnforcement ?? policy.gate_defaults.enforcement ?? policy.execution.enforcement?.default ?? "blocking";
  return enforcement === "advisory" ? "advisory" : "blocking";
}

export function createExecutionPlan(input: CreateExecutionPlanInput): ExecutionPlan {
  const { policy, phase, catalog } = input;
  if (policy.gates[phase].length > (policy.limits.maximum_gates ?? 1000)) {
    throw new GateError({ code: "CONFIG_SCHEMA", safeMessage: "The policy exceeds maximum_gates.", retryable: false });
  }
  const targetId = policy.execution.active_target;
  const target = policy.targets.definitions[targetId];
  if (target === undefined) {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: `Unknown active target: ${targetId}`,
      retryable: false
    });
  }
  const runtimeType = target.runtime.type;
  if (typeof runtimeType !== "string") {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: `Target ${targetId} does not declare a runtime type.`,
      retryable: false
    });
  }

  const availableProviders = collectProviders(policy);
  const operatingSystem =
    typeof target.runtime.operating_system === "string"
      ? target.runtime.operating_system
      : undefined;
  const gateApplicability = new Map<string, boolean>();
  for (const gate of policy.gates[phase]) {
    const conditionMatches = evaluateConditions(gate.when, {
      phase,
      runtimeType,
      ...(operatingSystem === undefined ? {} : { operatingSystem }),
      availableProviders
    });
    gateApplicability.set(gate.id, conditionMatches || gate.otherwise !== "skipped");
  }

  const supportedPhases = new Map(
    Object.values(catalog).map((definition) => [definition.type, definition.supportedPhases])
  );
  validatePolicyReferences(
    policy,
    phase,
    targetId,
    new Set(
      [...gateApplicability.entries()].filter(([, applicable]) => applicable).map(([id]) => id)
    ),
    new Set(Object.keys(catalog)),
    supportedPhases
  );

  const defaultTimeout =
    typeof policy.gate_defaults.timeout === "string" ? policy.gate_defaults.timeout : "60s";
  const gates: PlannedGate[] = policy.gates[phase].map((gate, index) => {
    const metadata = catalog[gate.type];
    if (metadata === undefined) {
      throw new GateError({
        code: "CONFIG_REFERENCE",
        safeMessage: `Unknown gate type: ${gate.type}`,
        retryable: false
      });
    }
    const applicable = gateApplicability.get(gate.id) === true;
    const requirements = applicable
      ? deduplicateRequirements(metadata.providerRequirements)
      : Object.freeze([]);
    return deepFreeze({
      index,
      id: gate.id,
      name: gate.name,
      type: gate.type,
      enforcement: gateEnforcement(policy, gate.enforcement),
      applicability: applicable ? "applicable" : "skipped",
      ...(applicable ? {} : { skipReason: "Gate condition did not match the active target." }),
      timeoutMs: parseDuration(defaultTimeout),
      providerRequirements: requirements,
      definition: structuredClone(gate) as Readonly<Record<string, unknown>>
    });
  });

  if (
    phase === "post_deployment" &&
    !gates.some((gate) => gate.applicability === "applicable" && gate.enforcement === "blocking")
  ) {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: "At least one applicable blocking post-deployment gate is required.",
      retryable: false
    });
  }

  const requiredProviders = deduplicateRequirements(
    gates.flatMap((gate) =>
      gate.applicability === "applicable" ? [...gate.providerRequirements] : []
    )
  );
  const plan: ExecutionPlan = {
    phase,
    targetId,
    runtimeType,
    gates: Object.freeze(gates),
    requiredProviders,
    deadlineMs: Math.min(parseDuration(policy.execution.phases[phase].timeout), parseDuration(policy.limits.maximum_total_runtime ?? policy.execution.phases[phase].timeout)),
    maximumTotalRuntimeMs: parseDuration(policy.limits.maximum_total_runtime ?? policy.execution.phases[phase].timeout),
    maximumQueries: policy.limits.maximum_queries ?? 1000,
    maximumQueryLengthBytes: parseByteSize(policy.limits.maximum_query_length, 16 * 1024),
    maximumResponseBytes: parseByteSize(policy.limits.maximum_provider_response_size, 2 * 1024 * 1024),
    concurrency: policy.execution.phases[phase].concurrency,
    perProviderConcurrency: policy.limits.maximum_parallel_requests_per_provider ?? 4,
    failFast: policy.execution.enforcement?.fail_fast ?? false
  };
  return deepFreeze(plan);
}
