import { EvidenceStore } from "@observability-gate/core";
import { describe, expect, it } from "vitest";
import { createPolicyProviderSession, type ProviderPolicy } from "../src/session.js";

const time = Date.parse("2026-10-22T00:00:00Z");
function policy(): ProviderPolicy {
  return {
    identity: {
      canonical: {
        service_name: "checkout",
        service_namespace: "commerce",
        environment: "production",
        release_id: "release-2"
      },
      provider_mappings: {
        metrics: {
          "service.name": "service_name",
          "service.namespace": "service_namespace",
          "service.version": "service_version",
          "deployment.environment.name": "deployment_environment"
        },
        logs: {
          "service.name": "service_name",
          "service.namespace": "service_namespace",
          "service.version": "service_version",
          "deployment.environment.name": "deployment_environment"
        }
      }
    },
    release: {},
    observation: {},
    execution: {},
    targets: {},
    providers: {
      telemetry: {
        metrics: { endpoint: "https://metrics.example.test" },
        logs: { endpoint: "https://logs.example.test" }
      }
    },
    gates: {},
    reporting: {},
    security: {},
    limits: {}
  };
}
function context() {
  return {
    phase: "post_deployment" as const,
    targetId: "target",
    releaseId: "release-2",
    evidenceStore: new EvidenceStore(() => new Date(time)),
    signal: new AbortController().signal,
    clock: () => new Date(time)
  };
}
function session(fetch: typeof globalThis.fetch, value = policy()) {
  return createPolicyProviderSession({
    policy: value,
    workspaceRoot: process.cwd(),
    environment: {},
    fetch,
    resolveHostname: async () => ["203.0.113.10"],
    clock: () => time
  });
}
function metric(value: number, labels: Record<string, string> = {}) {
  return new Response(
    JSON.stringify({
      status: "success",
      data: {
        resultType: "vector",
        result: [{ metric: labels, value: [time / 1000, String(value)] }]
      }
    })
  );
}

describe("default provider session truthfulness", () => {
  it("records provider acquisition events and timings without exposing queries", async () => {
    const events: unknown[] = [];
    const provider = createPolicyProviderSession({
      policy: policy(), workspaceRoot: process.cwd(), environment: {},
      fetch: async () => metric(1), resolveHostname: async () => ["203.0.113.10"],
      clock: () => time,
      onEvent: (event) => events.push(event)
    });
    await provider.resolveEvidence?.("metric.threshold", {source: {provider: "metrics", query: "secret-query"}, assertions: {operator: "greater_than", threshold: 0}}, context());
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({name: "provider_request_started", provider: "metrics"}),
      expect.objectContaining({name: "provider_request_completed", provider: "metrics"}),
      expect.objectContaining({name: "evidence_acquired"})
    ]));
    expect(JSON.stringify(events)).not.toContain("secret-query");
    expect(provider.timings?.()).toEqual([expect.objectContaining({provider: "metrics", calls: 1})]);
  });
  it("preserves a failing equality sample in a metric range", async () => {
    const provider = session(async () =>
      Response.json({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: {},
              values: [
                [time / 1000 - 1, "1"],
                [time / 1000, "2"]
              ]
            }
          ]
        }
      })
    );
    const evidence = await provider.resolveEvidence?.(
      "metric.threshold",
      {
        window: "1m",
        source: { provider: "metrics", query: "up" },
        assertions: { operator: "equal", threshold: 1, minimum_samples: 2 }
      },
      context()
    );
    expect(evidence?.[0]?.value).toMatchObject({ value: 2, sampleCount: 2 });
  });
  it("honors the configured total retry attempts", async () => {
    let calls = 0;
    const input = policy();
    const provider = session(
      async () => {
        calls++;
        return Response.json({}, { status: 503 });
      },
      {
        ...input,
        execution: {
          retries: {
            attempts: 1,
            initial_backoff: "1ms",
            maximum_backoff: "1ms",
            retry_on: ["http_503"]
          }
        }
      }
    );
    const raw = await provider.resolveEvidence?.(
      "metric.threshold",
      { source: { provider: "metrics", query: "up" } },
      context()
    );
    expect(raw?.[0]?.state).toBe("unavailable");
    expect(calls).toBe(1);
  });
  it("samples only applicable gates from the selected plan", async () => {
    const input = policy();
    const selected = {
      id: "selected",
      type: "metric.threshold",
      source: { provider: "metrics", query: "up" },
      assertions: { operator: "equal", threshold: 1 }
    };
    const skipped = {
      id: "windows-only",
      type: "vm.host_health",
      when: { operating_system: "windows" }
    };
    const provider = createPolicyProviderSession({
      policy: { ...input, gates: { post_deployment: [skipped, selected] } },
      workspaceRoot: process.cwd(),
      environment: {},
      fetch: async () => metric(1),
      resolveHostname: async () => ["203.0.113.10"],
      clock: () => time,
      plan: {
        phase: "post_deployment",
        targetId: "target",
        runtimeType: "generic",
        deadlineMs: 1000,
        requiredProviders: [],
        gates: [skipped, selected].map((definition, index) => ({
          index,
          id: definition.id,
          name: definition.id,
          type: definition.type,
          definition,
          enforcement: "blocking",
          applicability: index === 0 ? "skipped" : "applicable",
          timeoutMs: 1000,
          providerRequirements: []
        }))
      }
    });
    await expect(provider.sample?.(new AbortController().signal)).resolves.toBe(true);
  });

  it("applies the evidence file size limit independently of provider responses", async () => {
    const input = policy();
    const provider = session(async () => metric(1), {
      ...input,
      providers: {
        evidence: { synthetic: { files: ["fixtures/evidence/synthetic/results.json"] } }
      },
      security: { files: { maximum_evidence_file_size: "32B" } }
    });
    await expect(
      provider.resolveEvidence?.(
        "synthetic.result",
        { source: { provider: "synthetic" }, assertions: { required_tests: ["checkout-health"] } },
        context()
      )
    ).rejects.toMatchObject({
      code: "EVIDENCE_INVALID",
      safeMessage: "Evidence file exceeds the configured size limit"
    });
  });
  it("does not equate nonempty metric results with canonical identity", async () => {
    const provider = session(async () => metric(1, { service_name: "other" }));
    const evidence = await provider.resolveEvidence?.(
      "telemetry.presence",
      { source: { provider: "metrics", query: "up" }, assertions: {} },
      context()
    );
    expect(evidence?.[0]?.value).toMatchObject({ identityMatches: false });
  });
  it("measures request counts with an independent query", async () => {
    const provider = session(async (input) =>
      metric(String(input).includes("request_total") ? 250 : 0.01)
    );
    const evidence = await provider.resolveEvidence?.(
      "metric.threshold",
      {
        source: { provider: "metrics", query: "error_ratio", request_count_query: "request_total" },
        assertions: { minimum_requests: 200 }
      },
      context()
    );
    expect(evidence?.[0]?.value).toMatchObject({ requestCount: 250, minimumRequests: 200 });
  });
  it("rejects ambiguous metric vectors instead of choosing their first value", async () => {
    const provider = session(
      async () =>
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              resultType: "vector",
              result: [
                { metric: { host: "a" }, value: [time / 1000, "1"] },
                { metric: { host: "b" }, value: [time / 1000, "2"] }
              ]
            }
          })
        )
    );
    await expect(
      provider.resolveEvidence?.(
        "metric.threshold",
        { source: { provider: "metrics", query: "up" } },
        context()
      )
    ).rejects.toMatchObject({
      code: "EVIDENCE_INVALID",
      safeMessage:
        "Scalar gate query must return exactly one metric sample; aggregate or filter the query"
    });
  });
  it("turns incomplete acquisition definitions into actionable configuration errors", async () => {
    const provider = session(async () => metric(1));
    await expect(
      provider.resolveEvidence?.(
        "telemetry.collector_health",
        { source: { provider: "metrics" } },
        context()
      )
    ).rejects.toMatchObject({ code: "CONFIG_REFERENCE" });
  });
  it("does not expose a no-op successful observation sampler", async () => {
    const p = policy();
    const provider = session(async () => metric(1), {
      ...p,
      gates: {
        post_deployment: [
          { type: "metric.threshold", source: { provider: "metrics", query: "up" } }
        ]
      }
    });
    expect(provider.sample).toBeTypeOf("function");
    expect(await provider.sample?.(new AbortController().signal)).toBe(true);
  });
});
