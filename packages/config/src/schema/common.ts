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
export const durationSchema = z.string().min(1);

export const phaseSettingsSchema = z
  .object({
    timeout: durationSchema,
    concurrency: z.number().int().positive()
  })
  .strict();
