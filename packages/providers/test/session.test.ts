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
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
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
