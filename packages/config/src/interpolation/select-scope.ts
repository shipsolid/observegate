import { GateError, type Phase } from "@observability-gate/core";
import type { RawPolicy } from "../schema/policy.js";
import { expandString, expandValue } from "./expand.js";

export interface InterpolationRequest {
  readonly phase: Phase;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly targetOverride?: string;
}

function selectScope(policy: RawPolicy, request: InterpolationRequest): RawPolicy {
  const activeTarget =
    request.targetOverride ?? expandString(policy.execution.active_target, request.environment);
  const target = policy.targets.definitions[activeTarget];
  if (target === undefined) {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: `The active target is not defined: ${activeTarget}`,
      retryable: false
    });
  }

  const selected = structuredClone(policy);
  selected.execution.active_target = activeTarget;
  selected.targets.definitions = { [activeTarget]: structuredClone(target) };
  selected.gates = {
    pre_deployment:
      request.phase === "pre_deployment" ? structuredClone(policy.gates.pre_deployment) : [],
    post_deployment:
      request.phase === "post_deployment" ? structuredClone(policy.gates.post_deployment) : []
  };
  return selected;
}

export function interpolatePolicy(policy: RawPolicy, request: InterpolationRequest): RawPolicy {
  const scoped = selectScope(policy, request);
  const interpolated = expandValue(scoped, request.environment, "preserve");

  if (policy.execution.environment_substitution !== undefined) {
    interpolated.execution.environment_substitution = structuredClone(
      policy.execution.environment_substitution
    );
  }

  interpolated.identity = expandValue(interpolated.identity, request.environment);
  const selectedTarget = interpolated.targets.definitions[interpolated.execution.active_target];
  if (selectedTarget === undefined) {
    throw new GateError({
      code: "INTERNAL",
      safeMessage: "The selected target was lost during interpolation.",
      retryable: false
    });
  }
  interpolated.targets.definitions[interpolated.execution.active_target] = expandValue(
    selectedTarget,
    request.environment
  );
  interpolated.gates[request.phase] = expandValue(
    interpolated.gates[request.phase],
    request.environment
  );

  if (request.phase === "post_deployment") {
    interpolated.release = expandValue(interpolated.release, request.environment);
  } else {
    interpolated.release.candidate.id = expandString(
      interpolated.release.candidate.id,
      request.environment
    );
  }

  return interpolated;
}
