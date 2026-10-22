import { z } from "zod";
import { gateContracts, type FieldContract } from "./gate-contracts.js";
import { gateEnvelopeSchema } from "./gate-envelope.js";
import { policySchema } from "./policy.js";
import {
  providerContract,
  runtimeContract,
  securityContract,
  reportingContract
} from "./validate-contract.js";

function contractSchema(contract: FieldContract): z.ZodType {
  if (contract === "any") return z.unknown();
  if (contract === "string") return z.string();
  if (contract === "number") return z.number().finite();
  if (contract === "boolean") return z.boolean();
  if (Array.isArray(contract)) return z.array(contractSchema(contract[0] ?? "any"));
  const variants = (contract as { readonly anyOf?: readonly FieldContract[] }).anyOf;
  if (variants !== undefined) return z.union(variants.map(contractSchema));
  const fields = contract as Readonly<Record<string, FieldContract>>;
  const object = z.object(
    Object.fromEntries(
      Object.entries(fields)
        .filter(([key]) => key !== "*")
        .map(([key, value]) => [key, contractSchema(value).optional()])
    )
  );
  return fields["*"] === undefined ? object.strict() : object.catchall(contractSchema(fields["*"]));
}

/** Generate structural contracts from the same Zod schema and field contracts used by parsePolicy. */
export function policyJsonSchema(): Readonly<Record<string, unknown>> {
  const provider = (group: string) =>
    (contractSchema(providerContract) as z.ZodObject).extend({
      type: z.enum(
        (
          {
            runtime: ["kubernetes", "azure_resource_manager", "evidence_only"],
            telemetry: ["prometheus", "mimir", "loki", "tempo", "grafana"],
            evidence: ["file", "json", "signed_json", "sarif", "otlp_capture", "junit_or_json"],
            http: ["http"]
          } as Record<string, [string, ...string[]]>
        )[group] ?? ["unsupported"]
      )
    });
  const runtime = (contractSchema(runtimeContract) as z.ZodObject).extend({
    type: z.enum([
      "generic",
      "generic_vm",
      "kubernetes",
      "azure_container_apps",
      "azure_vm",
      "linux_vm",
      "windows_vm"
    ]),
    provider: z.string().min(1)
  });
  const gates = Object.entries(gateContracts).map(([type, contract]) => {
    const fields: Record<string, z.ZodType> = Object.fromEntries(
      [
        "source",
        "sources",
        "assertions",
        "selectors",
        "dependencies",
        "metrics",
        "candidate",
        "baseline",
        "when"
      ].map((key) => [
        key,
        ((key === "metrics" || key === "dependencies") && contract[key] === undefined
          ? z.never()
          : contractSchema(contract[key] ?? {})
        ).optional()
      ])
    );
    if (type === "metric.threshold") {
      fields.assertions = (contractSchema(contract.assertions ?? {}) as z.ZodObject).extend({
        operator: z.enum([
          "greater_than",
          "greater_than_or_equal",
          "less_than",
          "less_than_or_equal",
          "equal",
          "gt",
          "gte",
          "lt",
          "lte",
          "eq"
        ]),
        threshold: z.number().finite()
      });
      fields.source = (contractSchema(contract.source ?? {}) as z.ZodObject).extend({
        query: z.string().min(1)
      });
    }
    if (type === "synthetic.result")
      fields.assertions = (contractSchema(contract.assertions ?? {}) as z.ZodObject).extend({
        required_tests: z.array(z.string().min(1)).min(1).meta({ uniqueItems: true })
      });
    if (type === "telemetry.cardinality_estimate" || type === "telemetry.volume_estimate") {
      const source = contractSchema(contract.source ?? {}) as z.ZodObject;
      fields.source = source.extend({
        provider: z.literal("metrics"),
        queries: source.shape.queries.unwrap()
      });
      const assertions = contractSchema(contract.assertions ?? {}) as z.ZodObject;
      const dimensions =
        type === "telemetry.volume_estimate"
          ? (assertions.shape.estimated_growth_percent.unwrap() as z.ZodObject).shape
          : assertions.shape;
      const limits = z
        .object(
          Object.fromEntries(
            Object.keys(dimensions).map((name) => [
              name,
              z
                .object({
                  less_than_or_equal:
                    type === "telemetry.cardinality_estimate" && !name.endsWith("_percent")
                      ? z.number().int().nonnegative()
                      : z.number().nonnegative()
                })
                .strict()
                .optional()
            ])
          )
        )
        .strict();
      fields.assertions =
        type === "telemetry.volume_estimate"
          ? z.object({ estimated_growth_percent: limits }).strict()
          : limits;
    }
    return gateEnvelopeSchema.extend({
      ...fields,
      type: z.literal(type),
      ...([
        "telemetry.cardinality_estimate",
        "telemetry.volume_estimate",
        "comparison.telemetry_volume"
      ].includes(type)
        ? { enforcement: z.literal("advisory").optional() }
        : {})
    });
  });
  // Unknown types are parsed structurally, then rejected by capability planning.
  const unknown = gateEnvelopeSchema.extend({
    type: z
      .string()
      .min(1)
      .refine((type) => gateContracts[type] === undefined)
  });
  const schema = z.toJSONSchema(
    policySchema.extend({
      targets: z
        .object({ definitions: z.record(z.string(), z.object({ runtime }).strict()) })
        .strict(),
      providers: z
        .object(
          Object.fromEntries(
            ["runtime", "telemetry", "evidence", "http"].map((group) => [
              group,
              z.record(z.string(), provider(group)).optional()
            ])
          )
        )
        .strict(),
      security: contractSchema(securityContract),
      reporting: contractSchema(reportingContract),
      gates: z
        .object({
          pre_deployment: z.array(z.union([...gates, unknown])),
          post_deployment: z.array(z.union([...gates, unknown]))
        })
        .strict()
    }),
    { io: "input" }
  );
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  const gateProperties = (properties.gates?.properties ?? {}) as Record<
    string,
    { items: { anyOf: Record<string, unknown>[] } }
  >;
  for (const phase of Object.values(gateProperties)) {
    const variants = phase.items.anyOf;
    for (const variant of variants) {
      const fields = variant.properties as Record<string, Record<string, unknown>>;
      if (
        fields?.type?.const === "telemetry.cardinality_estimate" ||
        fields?.type?.const === "telemetry.volume_estimate"
      ) {
        const assertionFields = fields.assertions;
        if (assertionFields !== undefined) {
          assertionFields.minProperties = 1;
          if (fields.type.const === "telemetry.volume_estimate")
            (
              (assertionFields.properties as Record<string, Record<string, unknown>>)
                .estimated_growth_percent ?? {}
            ).minProperties = 1;
        }
        const queryFields = (fields.source?.properties as Record<string, Record<string, unknown>>)
          ?.queries;
        if (queryFields !== undefined) queryFields.minProperties = 1;
      }
    }
    const fallback = variants[variants.length - 1];
    if (fallback === undefined) continue;
    (fallback.properties as Record<string, unknown>).type = {
      type: "string",
      minLength: 1,
      not: { enum: Object.keys(gateContracts) }
    };
  }
  return {
    ...schema,
    title: "ObserveGate policy",
    description:
      "Structural editor schema generated from runtime policy and field contracts. Run observegate validate for semantic and acquisition validation.",
    "x-semantic-validation": [
      "Cross-field and reference checks, bounded durations, safe URLs and environment names",
      "Safety invariants, provider-specific supported options, reporting selections and fixed decision mappings",
      "Nonnegative integer counts, percent/ratio bounds, supported signal and condition values",
      "Budget dimensions require matching nonempty queries and finite nonnegative limits; count budgets are integers; enforcement inherits advisory only",
      "Explicit distinct baseline identities, sample minima, unsupported Kubernetes inference assertions",
      "Synthetic test names must be distinct; gate acquisition prerequisites must be satisfied"
    ]
  };
}
