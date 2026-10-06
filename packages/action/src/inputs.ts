import * as core from "@actions/core";
import { GateError, type Phase } from "@observability-gate/core";

export interface ActionInputs {
  readonly config: string;
  readonly phase: Phase;
  readonly target?: string;
  readonly outputDirectory: string;
  readonly githubToken?: string;
}

export function readInputs(): ActionInputs {
  const phase = core.getInput("phase", { required: true });
  if (phase !== "pre_deployment" && phase !== "post_deployment") {
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage: "Action input phase must be pre_deployment or post_deployment.",
      retryable: false
    });
  }
  const target = core.getInput("target");
  const githubToken = core.getInput("github-token");
  return Object.freeze({
    config: core.getInput("config", { required: true }),
    phase,
    ...(target.length === 0 ? {} : { target }),
    outputDirectory: core.getInput("output-directory") || "observability-gate-results",
    ...(githubToken.length === 0 ? {} : { githubToken })
  });
}
