import { EvidenceStore } from "@observability-gate/core";
import { createPolicyProviderSession, type ProviderPolicy } from "../src/session.js";
import { describe, expect, it } from "vitest";
const now = Date.parse("2026-10-23T00:00:00Z");
const scoped = 'requests{service_name="checkout",deployment_environment="production"}';
function metric(query: string) {
  if (query.includes("broken")) return { status: "error", error: query };
  return {
    status: "success",
    data: {
      resultType: "vector",
      result: Array.from(
        { length: query.includes("empty") ? 0 : query.includes("fanout") ? 2 : 1 },
        (_, index) => ({
          metric: { instance: String(index) },
          value: [now / 1000, "1"]
        })
      )
    }
  };
}
async function resolve(
  gates: Record<string, unknown[]>,
  assertions: Record<string, unknown> = {},
  sources?: Record<string, string>
) {
  const policy: ProviderPolicy = {
    identity: {
      canonical: { service_name: "checkout", environment: "production", release_id: "r2" },
      provider_mappings: {
        metrics: {
          "service.name": "service_name",
          "deployment.environment.name": "deployment_environment"
        },
        logs: { "service.name": "service", "deployment.environment.name": "environment" }
      }
    },
    release: {},
    observation: {
      pre_deployment: { current_health_window: "15m" },
      post_deployment: { evaluation_window: "30m" }
    },
    execution: {},
    targets: {},
    providers: {
      telemetry: {
        metrics: { endpoint: "https://metrics.example.test" },
        logs: { endpoint: "https://logs.example.test" },
        traces: { endpoint: "https://traces.example.test" }
      }
    },
    gates,
    reporting: {},
    security: {},
    limits: {}
  };
  const urls: URL[] = [];
  const session = createPolicyProviderSession({
    policy,
    workspaceRoot: process.cwd(),
    environment: {},
    clock: () => now,
    resolveHostname: async () => ["203.0.113.10"],
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.hostname === "metrics.example.test")
        return Response.json(metric(url.searchParams.get("query") ?? ""));
      if (url.hostname === "logs.example.test")
        return Response.json({
          status: "success",
          data: {
            resultType: "streams",
            result: [
              {
                stream: { service: "checkout", environment: "production" },
                values: [[String(BigInt(now) * 1000000n), "message"]]
              }
            ]
          }
        });
      return Response.json({
        traces: [
          {
            traceID: "trace",
            startTimeUnixNano: String(BigInt(now) * 1000000n),
            durationMs: 10,
            rootServiceName: "checkout",
            resource: {
              "service.name": "checkout",
              "service.version": "r2",
              "deployment.environment.name": "production"
            },
            spans: []
          }
        ]
      });
    }
  });
  const evidence = await session.resolveEvidence?.(
    "telemetry.query_validation",
    { assertions, ...(sources === undefined ? {} : { sources }) },
    {
      phase: "pre_deployment",
      targetId: "target",
      evidenceStore: new EvidenceStore(),
      signal: new AbortController().signal,
      clock: () => new Date(now)
    }
  );
  return {
    evidence,
    urls,
    queries: (evidence?.[0]?.value as { queries: Record<string, unknown>[] })?.queries
  };
}
describe("query validation public acquisition", () => {
  it("collects nested comparison, burn window, dependency, and source query leaves", async () => {
    const result = await resolve({
      pre_deployment: [
        {
          type: "comparison.multi_metric",
          source: {
            provider: "metrics",
            queries: {
              cpu: { candidate: { query: scoped }, baseline: { query: `sum(${scoped})` } }
            }
          }
        },
        {
          type: "grafana.burn_rate",
          assertions: { windows: [{ short_query: `max(${scoped})`, long_query: `min(${scoped})` }] }
        },
        { type: "dependency.health", dependencies: [{ query: `avg(${scoped})` }] }
      ]
    });
    expect(result.queries).toHaveLength(5);
    expect(result.urls).toHaveLength(5);
    expect(result.queries.every((q) => q.valid)).toBe(true);
    expect(JSON.stringify(result.evidence)).not.toContain(scoped);
  });
  it("honors the requested gate scope and deduplicates repeated queries", async () => {
    const result = await resolve(
      {
        pre_deployment: [
          { type: "metric.threshold", source: { provider: "metrics", query: scoped } }
        ],
        post_deployment: [
          {
            type: "metric.threshold",
            source: {
              provider: "metrics",
              queries: { one: `sum(${scoped})`, duplicate: `sum(${scoped})` }
            }
          }
        ]
      },
      { validate_queries_from: ["gates.post_deployment"] }
    );
    expect(result.queries).toHaveLength(1);
    expect(result.urls).toHaveLength(1);
    expect(result.urls[0]?.searchParams.get("query")).toBe(`sum(${scoped})`);
  });
  it("validates all telemetry backends including identity-based trace search", async () => {
    const result = await resolve({
      post_deployment: [
        {
          type: "telemetry.correlation",
          source: {
            queries: {
              metrics: scoped,
              logs: '{service="checkout",environment="production"}',
              traces: {
                "resource.service.name": "checkout",
                "resource.deployment.environment.name": "production"
              }
            }
          }
        }
      ]
    });
    expect(result.queries).toHaveLength(3);
    expect(result.queries.map((q) => q.signal).sort()).toEqual(["logs", "metrics", "traces"]);
    expect(result.urls).toHaveLength(3);
    expect(result.queries.every((query) => query.valid && query.scoped)).toBe(true);
    expect(result.evidence?.[0]?.state).toBe("valid");
  });
  it("treats without labels as exclusions instead of by grouping", async () => {
    const result = await resolve({
      pre_deployment: [
        {
          type: "metric.threshold",
          source: { provider: "metrics", query: `sum without(user_id) (${scoped})` }
        }
      ]
    });
    expect(result.queries[0]?.groupBy).toEqual([]);
  });
  it("marks excessive range selectors before backend acquisition", async () => {
    const result = await resolve(
      {
        pre_deployment: [
          {
            type: "metric.threshold",
            source: { provider: "metrics", query: `rate(${scoped}[25h])` }
          }
        ]
      },
      { maximum_query_range: "24h" }
    );
    expect(result.queries[0]?.rangeMs).toBeGreaterThan(86400000);
    expect(result.urls).toHaveLength(0);
  });
  it("rejects unsupported scopes explicitly", async () => {
    await expect(
      resolve({ pre_deployment: [] }, { validate_queries_from: ["everything"] })
    ).rejects.toThrow(/scope/iu);
  });
  it("rejects raw TraceQL rather than silently validating another query", async () => {
    await expect(
      resolve({
        pre_deployment: [
          {
            type: "trace.assertion",
            source: { provider: "traces", query: '{ resource.service.name = "checkout" }' }
          }
        ]
      })
    ).rejects.toThrow(/TraceQL/iu);
  });

  it("rejects broad log selectors before acquiring them when configured", async () => {
    const result = await resolve(
      {
        pre_deployment: [
          { type: "telemetry.presence", source: { provider: "logs", query: '{service=~".*"}' } }
        ]
      },
      { reject_unbounded_log_queries: true }
    );
    expect(result.queries[0]).toMatchObject({ bounded: false, valid: false });
    expect(result.urls).toHaveLength(0);
  });
  it("keeps a multi-series result visible for scalar-policy evaluation", async () => {
    const result = await resolve({
      pre_deployment: [
        { type: "metric.threshold", source: { provider: "metrics", query: `fanout_${scoped}` } }
      ]
    });
    expect(result.queries[0]).toMatchObject({ threshold: true, shape: "vector", valid: true });
  });
  it("does not claim that identity labels with the wrong values prove scope", async () => {
    const result = await resolve({
      pre_deployment: [
        {
          type: "metric.threshold",
          source: {
            provider: "metrics",
            query: 'requests{service_name="other",deployment_environment="production"}'
          }
        }
      ]
    });
    expect(result.queries[0]).toMatchObject({ scoped: false });
  });
  it("ignores grouping-like text inside quoted label values", async () => {
    const result = await resolve({
      pre_deployment: [
        {
          type: "metric.threshold",
          source: {
            provider: "metrics",
            query:
              'sum(requests{service_name="checkout",deployment_environment="production",message="by(user_id)"})'
          }
        }
      ]
    });
    expect(result.queries[0]?.groupBy).toEqual([]);
  });
  it("validates compilation independently of a successful empty query response", async () => {
    const result = await resolve({
      pre_deployment: [
        { type: "metric.threshold", source: { provider: "metrics", query: `empty_${scoped}` } }
      ]
    });
    expect(result.queries[0]).toMatchObject({ valid: true, shape: "vector" });
    expect(result.evidence?.[0]?.state).toBe("valid");
  });
  it("sanitizes backend query errors instead of emitting raw query text", async () => {
    const query = `broken_${scoped}`;
    const result = await resolve({
      pre_deployment: [{ type: "metric.threshold", source: { provider: "metrics", query } }]
    });
    expect(result.queries[0]).toMatchObject({ valid: false });
    expect(result.evidence?.[0]?.state).toBe("invalid");
    expect(JSON.stringify(result.evidence)).not.toContain(query);
  });
  it("rejects absolute query time when a maximum range cannot be established", async () => {
    const result = await resolve(
      {
        pre_deployment: [
          {
            type: "metric.threshold",
            source: { provider: "metrics", query: `${scoped} @ 1792713600` }
          }
        ]
      },
      { maximum_query_range: "1h" }
    );
    expect(result.queries[0]).toMatchObject({ valid: false, rangeSupported: false });
    expect(result.urls).toHaveLength(0);
  });

  it("does not treat a scoped selector as proof for an unrelated bare vector", async () => {
    const result = await resolve({
      pre_deployment: [
        {
          type: "metric.threshold",
          source: { provider: "metrics", query: `sum(unscoped_metric)+sum(${scoped})` }
        }
      ]
    });
    expect(result.queries[0]).toMatchObject({ valid: true, scoped: false });
  });

  it("respects backend selection without validating excluded raw TraceQL", async () => {
    const result = await resolve(
      {
        pre_deployment: [
          {
            type: "telemetry.correlation",
            source: { queries: { metrics: scoped, traces: "unsupported raw TraceQL" } }
          }
        ]
      },
      {},
      { metrics: "metrics" }
    );
    expect(result.queries).toHaveLength(1);
    expect(result.urls).toHaveLength(1);
    expect(result.queries[0]?.signal).toBe("metrics");
  });
  it("does not discover scope inside a backtick string literal", async () => {
    const query =
      'label_replace(unscoped_metric,"replacement",`{service_name="checkout",deployment_environment="production"}`,"label",".*")';
    const result = await resolve({
      pre_deployment: [{ type: "metric.threshold", source: { provider: "metrics", query } }]
    });
    expect(result.queries[0]).toMatchObject({ valid: true, scoped: false });
  });
});
