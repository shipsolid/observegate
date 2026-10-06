import { z } from "zod";
import {
  configObjectSchema,
  configValueSchema,
  durationSchema,
  phaseSettingsSchema
} from "./common.js";
import { gateEnvelopeSchema } from "./gate-envelope.js";

const metadataSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    owner: z.string().min(1).optional(),
    service_tier: z.string().min(1).optional(),
    tags: z.record(z.string(), z.string()).optional()
  })
  .strict();

const executionSchema = z
  .object({
    active_target: z.string().min(1),
    environment_substitution: z
      .object({
        syntax: z.string(),
        scope: z.string(),
        missing_required_variable: z.string(),
        allow_default_values: z.boolean()
      })
      .strict()
      .optional(),
    phases: z
      .object({
        pre_deployment: phaseSettingsSchema,
        post_deployment: phaseSettingsSchema
      })
      .strict(),
    retries: z
      .object({
        attempts: z.number().int().nonnegative(),
        initial_backoff: durationSchema,
        maximum_backoff: durationSchema,
        retry_on: z.array(z.string())
      })
      .strict()
      .optional(),
    enforcement: z
      .object({
        default: z.enum(["blocking", "advisory"]),
        fail_fast: z.boolean(),
        minimum_evidence_coverage_percent: z.number().min(0).max(100),
        missing_blocking_evidence: z.string(),
        provider_unavailable: z.string(),
        unsupported_gate: z.string()
      })
      .strict()
      .optional(),
    clock: z
      .object({
        maximum_clock_skew: durationSchema
      })
      .strict()
      .optional()
  })
  .strict();

const identitySchema = z
  .object({
    canonical: z
      .object({
        service_name: z.string(),
        service_namespace: z.string(),
        environment: z.string(),
        release_id: z.string(),
        deployment_id: z.string()
      })
      .strict(),
    required_resource_attributes: z.array(z.string()).optional(),
    recommended_resource_attributes: z.array(z.string()).optional(),
    provider_mappings: z.record(z.string(), z.record(z.string(), z.string())).optional()
  })
  .strict();

const releaseSchema = z
  .object({
    candidate: z
      .object({
        id: z.string(),
        deployed_at: z.string().optional(),
        minimum_age_before_evaluation: durationSchema.optional(),
        maximum_age_before_evaluation: durationSchema.optional()
      })
      .strict(),
    baseline: z
      .object({
        strategy: z.string(),
        explicit_release_id: z.string().optional(),
        lookback: durationSchema,
        minimum_samples: z.number().int().nonnegative(),
        exclude_incident_windows: z.boolean(),
        exclude_deployment_windows: z.boolean()
      })
      .strict()
      .optional(),
    comparison: z
      .object({
        method: z.string(),
        minimum_candidate_samples: z.number().int().nonnegative(),
        low_traffic_behavior: z.string(),
        maximum_extension: durationSchema
      })
      .strict()
      .optional()
  })
  .strict();

const observationSchema = z
  .object({
    pre_deployment: z
      .object({
        current_health_window: durationSchema.optional(),
        current_health_offset: durationSchema.optional(),
        evidence_max_age: durationSchema.optional()
      })
      .strict(),
    post_deployment: z
      .object({
        warmup: durationSchema.optional(),
        evaluation_window: durationSchema.optional(),
        step: durationSchema.optional(),
        settle_between_samples: durationSchema.optional(),
        minimum_successful_samples: z.number().int().nonnegative().optional(),
        maximum_evidence_age: durationSchema.optional()
      })
      .strict(),
    no_data: z
      .object({
        blocking_gate: z.string(),
        advisory_gate: z.string(),
        comparison_gate: z.string(),
        synthetic_gate: z.string()
      })
      .strict()
      .optional()
  })
  .strict();

const outcomeSchema = z
  .object({
    exit_code: z.number().int().min(0).max(255),
    conclusion: z.string().min(1)
  })
  .strict();

const decisionSchema = z
  .object({
    outcomes: z
      .object({
        pass: outcomeSchema,
        warn: outcomeSchema,
        fail: outcomeSchema,
        inconclusive: outcomeSchema,
        error: outcomeSchema
      })
      .strict(),
    aggregate: z
      .object({
        fail_when: z.array(z.string()),
        warn_when: z.array(z.string()),
        pass_when: z.array(z.string())
      })
      .strict()
      .optional()
  })
  .strict();

const targetDefinitionSchema = z
  .object({
    runtime: configObjectSchema
  })
  .strict();

const targetsSchema = z
  .object({
    definitions: z.record(z.string(), targetDefinitionSchema)
  })
  .strict();

const providerDefinitionSchema = z.record(z.string(), configValueSchema);
const providerGroupSchema = z.record(z.string(), providerDefinitionSchema);
const providersSchema = z
  .object({
    runtime: providerGroupSchema.optional(),
    telemetry: providerGroupSchema.optional(),
    evidence: providerGroupSchema.optional(),
    http: providerGroupSchema.optional()
  })
  .strict();

const gateDefaultsSchema = z
  .object({
    enabled: z.boolean().optional(),
    enforcement: z.enum(["blocking", "advisory"]).optional(),
    timeout: durationSchema.optional(),
    retries: configValueSchema.optional(),
    target: z.string().optional(),
    emit: z.array(z.string()).optional(),
    redact: z.array(z.string()).optional()
  })
  .strict();

const gatesSchema = z
  .object({
    pre_deployment: z.array(gateEnvelopeSchema),
    post_deployment: z.array(gateEnvelopeSchema)
  })
  .strict();

const reportingSchema = z
  .object({
    github: configObjectSchema.optional(),
    artifacts: configObjectSchema.optional(),
    outputs: z.array(configValueSchema).optional(),
    links: configObjectSchema.optional()
  })
  .strict();

const securitySchema = z
  .object({
    read_only: z.boolean().optional(),
    prohibited_operations: z.array(z.string()).optional(),
    secrets: configObjectSchema.optional(),
    network: configObjectSchema.optional(),
    files: configObjectSchema.optional(),
    evidence: configObjectSchema.optional(),
    commands: configObjectSchema.optional()
  })
  .strict();

const limitsSchema = z
  .object({
    maximum_gates: z.number().int().positive().optional(),
    maximum_queries: z.number().int().positive().optional(),
    maximum_query_length: configValueSchema.optional(),
    maximum_total_runtime: durationSchema.optional(),
    maximum_parallel_requests_per_provider: z.number().int().positive().optional(),
    maximum_provider_response_size: configValueSchema.optional(),
    maximum_report_size: configValueSchema.optional()
  })
  .strict();

export const policySchema = z
  .object({
    metadata: metadataSchema,
    execution: executionSchema,
    identity: identitySchema,
    release: releaseSchema,
    observation: observationSchema,
    decision: decisionSchema,
    targets: targetsSchema,
    providers: providersSchema,
    gate_defaults: gateDefaultsSchema,
    gates: gatesSchema,
    reporting: reportingSchema,
    security: securitySchema,
    limits: limitsSchema
  })
  .strict();

export type RawPolicy = z.infer<typeof policySchema>;
