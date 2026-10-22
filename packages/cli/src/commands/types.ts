import type {
  Diagnostic,
  ExecutionPlan,
  ExecutionRequest,
  ExecutionResult,
  GateCatalogMetadata
} from "@observability-gate/core";
import type { PublicationOptions } from "@observability-gate/config";
import type { OutputWriter } from "../output.js";

export interface CliService {
  readonly validate: (request: ExecutionRequest) => Promise<readonly Diagnostic[]>;
  readonly plan: (request: ExecutionRequest) => Promise<ExecutionPlan>;
  readonly run: (request: ExecutionRequest) => Promise<ExecutionResult>;
  readonly publicationOptions?: (request: ExecutionRequest) => Promise<PublicationOptions>;
  readonly maximumReportBytes?: (request: ExecutionRequest) => Promise<number>;
}

export interface CommandContext {
  readonly service: CliService;
  readonly catalog: GateCatalogMetadata;
  readonly output: OutputWriter;
  readonly workspaceRoot: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}

export interface CommonOptions {
  readonly config: string;
  readonly phase?: string;
  readonly target?: string;
  readonly json?: boolean;
}

export function executionRequest(
  options: CommonOptions,
  context: CommandContext,
  defaultPhase: ExecutionRequest["phase"] = "pre_deployment"
): ExecutionRequest {
  const phase = options.phase ?? defaultPhase;
  if (phase !== "pre_deployment" && phase !== "post_deployment") {
    throw new Error("Phase must be pre_deployment or post_deployment.");
  }
  return {
    workspaceRoot: context.workspaceRoot,
    configPath: options.config,
    phase,
    ...(options.target === undefined ? {} : { targetOverride: options.target }),
    environment: context.environment,
    cancellationSignal: context.signal
  };
}
