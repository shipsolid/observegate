import { GateError, type Phase } from "@observability-gate/core";
import { githubActionsRuntime, type ActionRuntime } from "./actions-runtime.js";

export interface ActionInputs {
  readonly config: string;
  readonly phase: Phase;
  readonly target?: string;
  readonly outputDirectory: string;
  readonly githubToken?: string;
}

export function readInputs(runtime: ActionRuntime = githubActionsRuntime): ActionInputs {
  const phase = runtime.getInput("phase", { required: true });
  if (phase !== "pre_deployment" && phase !== "post_deployment") {
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage: "Action input phase must be pre_deployment or post_deployment.",
      retryable: false
    });
  }
  const target = runtime.getInput("target");
  const githubToken = runtime.getInput("github-token");
  return Object.freeze({
    config: runtime.getInput("config", { required: true }),
    phase,
    ...(target.length === 0 ? {} : { target }),
    outputDirectory: runtime.getInput("output-directory") || "observability-gate-results",
    ...(githubToken.length === 0 ? {} : { githubToken })
  });
}
