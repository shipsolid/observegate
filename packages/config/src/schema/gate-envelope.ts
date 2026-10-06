import { z } from "zod";
import { configObjectSchema, configValueSchema } from "./common.js";

export const gateEnvelopeSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    description: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    enforcement: z.enum(["blocking", "advisory"]).optional(),
    source: configObjectSchema.optional(),
    sources: configObjectSchema.optional(),
    candidate: configObjectSchema.optional(),
    baseline: configObjectSchema.optional(),
    window: configValueSchema.optional(),
    dependencies: z.array(configValueSchema).optional(),
    selectors: configObjectSchema.optional(),
    metrics: z.array(configValueSchema).optional(),
    assertions: configObjectSchema.optional(),
    when: configObjectSchema.optional(),
    otherwise: configValueSchema.optional(),
    remediation: z.string().min(1).optional()
  })
  .strict();

export type RawGateEnvelope = z.infer<typeof gateEnvelopeSchema>;
