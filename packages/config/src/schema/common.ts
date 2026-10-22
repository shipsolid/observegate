import { z } from "zod";

export type ConfigValue =
  | null
  | boolean
  | number
  | string
  | readonly ConfigValue[]
  | { readonly [key: string]: ConfigValue };

export const configValueSchema: z.ZodType<ConfigValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(configValueSchema),
    z.record(z.string(), configValueSchema)
  ])
);

export const configObjectSchema = z.record(z.string(), configValueSchema);
export const durationSchema = z
  .string()
  .regex(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u, "Expected a bounded duration such as 30s or 5m.")
  .refine(
    (value) =>
      Number.isFinite(Number.parseFloat(value)) &&
      Number.parseFloat(value) <= Number.MAX_SAFE_INTEGER / 86_400_000,
    "Duration is too large."
  );

export const phaseSettingsSchema = z
  .object({
    timeout: durationSchema,
    concurrency: z.number().int().positive()
  })
  .strict();
