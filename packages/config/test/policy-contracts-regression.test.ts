import { readFile } from "node:fs/promises";
import { EvidenceStore } from "@observability-gate/core";
import { createBuiltInGateCatalog } from "@observability-gate/gates";
import {
  createPolicyProviderSession,
  validateProviderAcquisition
} from "@observability-gate/providers";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import * as config from "../src/index.js";

async function minimal() {
  return parse(await readFile("fixtures/configs/minimal-valid.yml", "utf8")) as ReturnType<
    typeof config.parsePolicy
  >;
}
const dimensions = {
  "telemetry.cardinality_estimate": [
    "new_metric_series",
    "new_log_attribute_keys",
    "new_span_attribute_keys",
    "estimated_series_growth_percent"
  ],
  "telemetry.volume_estimate": ["metrics", "logs", "traces"]
};

describe("supported public policy contracts", () => {
  it.each(
    Object.entries(dimensions).flatMap(([type, names]) =>
      names.flatMap((name) => [50, 101, undefined].map((measured) => ({ type, name, measured })))
    )
  )("evaluates $type $name measured=$measured", async ({ type, name, measured }) => {
    const input = await minimal();
    input.providers.telemetry = {
      metrics: { type: "prometheus", endpoint: "https://metrics.example.test" }
    };
    input.gates.pre_deployment = [
      {
        id: "budget",
        name: "Budget",
        type,
        enforcement: "advisory",
        source: { provider: "metrics", queries: { [name]: "measured_dimension" } },
        assertions: type.includes("cardinality")
          ? { [name]: { less_than_or_equal: 100 } }
          : { estimated_growth_percent: { [name]: { less_than_or_equal: 100 } } }
      }
    ];
    const policy = config.parsePolicy(stringify(input));
    expect(validateProviderAcquisition(policy, "pre_deployment")).toEqual([]);
    const clock = () => new Date("2026-10-22T00:00:00Z");
    const provider = createPolicyProviderSession({
      policy,
      workspaceRoot: process.cwd(),
      environment: {},
      clock: () => clock().getTime(),
      resolveHostname: async () => ["203.0.113.10"],
      fetch: async () =>
        Response.json({
          status: "success",
          data: {
            resultType: "vector",
            result:
              measured === undefined
                ? []
                : [{ metric: {}, value: [clock().getTime() / 1000, String(measured)] }]
          }
        })
    });
    const definition = policy.gates.pre_deployment[0];
    if (definition === undefined) throw new Error("Budget test gate missing");
    const gate = createBuiltInGateCatalog().require(type, "pre_deployment", definition);
    const context = {
      phase: "pre_deployment" as const,
      targetId: "test",
      releaseId: "release-1",
      evidenceStore: new EvidenceStore(clock),
      signal: new AbortController().signal,
      clock,
      resolveEvidence: provider.resolveEvidence
    };
    const evidence = await gate.acquire(context);
    const results = gate.evaluate(evidence, context);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe(
      measured === undefined ? "inconclusive" : measured <= 100 ? "passed" : "failed"
    );
    expect(results[0]?.assertion).toContain(name);
  });

  it.each([
    { strategy: "previous_healthy_release", minimum_samples: 1 },
    { strategy: "explicit_or_previous_healthy_release", minimum_samples: 1 },
    { strategy: "explicit", minimum_samples: 1, lookback: "24h" },
    { strategy: "explicit", minimum_samples: 1, exclude_incident_windows: true },
    { strategy: "explicit", minimum_samples: 1, exclude_deployment_windows: true }
  ])("rejects unsupported baseline settings %j", async (baseline) => {
    const policy = await minimal();
    policy.release.baseline = {
      explicit_release_id: "baseline",
      ...baseline
    } as typeof policy.release.baseline;
    expect(() => config.parsePolicy(stringify(policy))).toThrow();
  });

  it("rejects budget assertions without named measurement queries", async () => {
    const policy = await minimal();
    policy.gates.pre_deployment = [
      {
        id: "budget",
        name: "Budget",
        type: "telemetry.cardinality_estimate",
        enforcement: "advisory",
        source: { provider: "metrics", queries: { estimate: "estimate" } },
        assertions: { new_metric_series: { less_than_or_equal: 500 } }
      }
    ];
    expect(() => config.parsePolicy(stringify(policy))).toThrow();
  });

  it("exports a generated schema with strict gate, provider and runtime contracts", () => {
    const schema = (
      config as unknown as { policyJsonSchema(): Record<string, unknown> }
    ).policyJsonSchema();
    expect(schema.$schema).toContain("json-schema.org");
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).toContain('"const":"telemetry.cardinality_estimate"');
    expect(JSON.stringify(schema)).toContain('"startup_probe_required"');
  });
});

it.each([1, 2])(
  "preserves explicit baseline queries and enforces global sample minimum %s",
  async (minimum) => {
    const input = await minimal();
    input.providers.telemetry = {
      metrics: { type: "prometheus", endpoint: "https://metrics.example.test" }
    };
    input.release.baseline = {
      strategy: "explicit",
      explicit_release_id: "baseline",
      minimum_samples: minimum
    };
    input.release.comparison = {
      method: "relative_and_absolute",
      minimum_candidate_samples: minimum,
      low_traffic_behavior: "inconclusive",
      maximum_extension: "0s"
    };
    input.gates.post_deployment = [
      {
        id: "compare",
        name: "Compare",
        type: "comparison.metric",
        source: {
          provider: "metrics",
          candidate: { release_id: "candidate", query: "candidate_latency" },
          baseline: { release_id: "baseline", query: "baseline_latency" }
        },
        assertions: { maximum_absolute_regression: 1 }
      }
    ];
    const policy = config.parsePolicy(stringify(input));
    const queries: string[] = [];
    const clock = () => new Date("2026-10-22T00:00:00Z");
    const provider = createPolicyProviderSession({
      policy,
      workspaceRoot: process.cwd(),
      environment: {},
      clock: () => clock().getTime(),
      resolveHostname: async () => ["203.0.113.10"],
      fetch: async (url) => {
        queries.push(new URL(url).searchParams.get("query") ?? "");
        return Response.json({
          status: "success",
          data: {
            resultType: "vector",
            result: [{ metric: {}, value: [clock().getTime() / 1000, "0.5"] }]
          }
        });
      }
    });
    const definition = policy.gates.post_deployment[0];
    if (definition === undefined) throw new Error("Comparison fixture missing");
    const context = {
      phase: "post_deployment" as const,
      targetId: "test",
      releaseId: "candidate",
      evidenceStore: new EvidenceStore(clock),
      signal: new AbortController().signal,
      clock,
      resolveEvidence: provider.resolveEvidence
    };
    const gate = createBuiltInGateCatalog().require(
      "comparison.metric",
      "post_deployment",
      definition
    );
    const evidence = await gate.acquire(context);
    const assertions = gate.evaluate(evidence, context);
    expect(queries).toEqual(["candidate_latency", "baseline_latency"]);
    expect(evidence[0]?.value).toMatchObject({
      candidate: { releaseId: "candidate", samples: 1 },
      baseline: { releaseId: "baseline", samples: 1 },
      minimumCandidateSamples: minimum,
      minimumBaselineSamples: minimum
    });
    expect(assertions.every((a) => a.status === "passed")).toBe(minimum === 1);
    if (minimum === 2) expect(assertions[0]?.status).toBe("inconclusive");
  }
);

it.each([
  { low_traffic_behavior: "extend_then_inconclusive", maximum_extension: "0s" },
  { low_traffic_behavior: "inconclusive", maximum_extension: "15m" },
  { low_traffic_behavior: "ignore", maximum_extension: "0s" }
])("rejects unsupported automatic low-traffic behavior %j", async (unsupported) => {
  const input = await minimal();
  input.release.comparison = {
    method: "relative_and_absolute",
    minimum_candidate_samples: 1,
    ...unsupported
  } as typeof input.release.comparison;
  expect(() => config.parsePolicy(stringify(input))).toThrow();
});

it.each([
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.gate_defaults.enabled = false as true;
  },
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.gate_defaults.target = "another-target" as "active";
  },
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.gate_defaults.retries = "disabled" as "inherit";
  },
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.gate_defaults.redact = ["authorization"];
  },
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.decision.aggregate = { fail_when: [], warn_when: [], pass_when: [] };
  },
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.gates.pre_deployment = [
      {
        id: "self",
        name: "Self",
        type: "policy.self_check",
        assertions: { reject_unknown_fields: false }
      }
    ];
  },
  (p: Awaited<ReturnType<typeof minimal>>) => {
    p.gates.pre_deployment = [
      {
        id: "self",
        name: "Self",
        type: "policy.self_check",
        assertions: { require_sections: ["identity"] }
      }
    ];
  }
])("rejects unsupported overrides of fixed policy behavior", async (mutate) => {
  const input = await minimal();
  mutate(input);
  expect(() => config.parsePolicy(stringify(input))).toThrow();
});

it("publishes exact nested field types and mandatory structural fields", () => {
  type Schema = {
    [key: string]: unknown;
    properties?: Record<string, Schema>;
    items?: Schema;
    anyOf?: Schema[];
    required?: string[];
    additionalProperties?: boolean | Schema;
  };
  const schema = config.policyJsonSchema() as Schema;
  const root = schema.properties ?? {};
  expect(schema.required).toContain("targets");
  expect(root.metadata?.required).toEqual(["name"]);
  const runtime = (root.targets?.properties?.definitions?.additionalProperties as Schema)
    ?.properties?.runtime;
  expect(runtime?.required).toEqual(["type", "provider"]);
  expect(runtime?.additionalProperties).toBe(false);
  expect(runtime?.properties?.workload?.additionalProperties).toBe(false);
  expect(runtime?.properties?.workload?.properties?.container?.type).toBe("string");
  const metricProvider = root.providers?.properties?.telemetry?.additionalProperties as Schema;
  expect(metricProvider.required).toEqual(["type"]);
  expect(metricProvider.additionalProperties).toBe(false);
  expect(metricProvider.properties?.signature?.additionalProperties).toBe(false);
  expect(metricProvider.properties?.signature?.properties?.jwks_file?.type).toBe("string");
  const variants = root.gates?.properties?.pre_deployment?.items?.anyOf ?? [];
  const metric = variants.find((variant) => variant.properties?.type?.const === "metric.threshold");
  expect(metric?.required).toEqual(
    expect.arrayContaining(["id", "name", "type", "source", "assertions"])
  );
  expect(metric?.properties?.assertions?.required).toEqual(["operator", "threshold"]);
  expect(metric?.properties?.assertions?.properties?.threshold?.type).toBe("number");
  expect(metric?.properties?.assertions?.additionalProperties).toBe(false);
  const budget = variants.find(
    (variant) => variant.properties?.type?.const === "telemetry.cardinality_estimate"
  );
  expect(budget?.properties?.source?.required).toEqual(["provider", "queries"]);
  expect(budget?.properties?.source?.properties?.queries?.additionalProperties).toBe(false);
  expect(budget?.properties?.source?.properties?.queries?.properties?.new_metric_series?.type).toBe(
    "string"
  );
  expect(budget?.properties?.assertions?.minProperties).toBe(1);
  expect(budget?.properties?.assertions?.properties?.new_metric_series?.additionalProperties).toBe(
    false
  );
  expect(budget?.properties?.assertions?.properties?.new_metric_series?.required).toEqual([
    "less_than_or_equal"
  ]);
  expect(
    budget?.properties?.assertions?.properties?.new_metric_series?.properties?.less_than_or_equal
      ?.minimum
  ).toBe(0);
  expect(root.release?.properties?.baseline?.required).toEqual([
    "strategy",
    "explicit_release_id",
    "minimum_samples"
  ]);
  expect(root.release?.properties?.baseline?.properties?.strategy?.const).toBe("explicit");
  expect(schema["x-semantic-validation"]).toEqual(
    expect.arrayContaining([expect.stringContaining("Budget dimensions")])
  );
});
