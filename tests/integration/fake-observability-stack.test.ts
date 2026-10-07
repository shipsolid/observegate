import { EvidenceStore } from "@observability-gate/core";
import { createPolicyProviderSession, type ProviderPolicy } from "@observability-gate/providers";
import { describe, expect, it } from "vitest";
import { FakeObservabilityStack } from "./fake-observability-stack.js";

const now = Date.parse("2026-10-06T00:00:00.000Z");

function policy(): ProviderPolicy {
  return {
    identity: {
      canonical: {
        service_name: "checkout",
        service_namespace: "commerce",
        environment: "production",
        release_id: "release-candidate",
        deployment_id: "deployment-1"
      },
      provider_mappings: {
        metrics: {
          "service.name": "service_name",
          "service.namespace": "service_namespace",
          "service.version": "service_version",
          "deployment.environment.name": "deployment_environment"
        }
      }
    },
    release: {},
    observation: { pre_deployment: { current_health_window: "15m" }, post_deployment: {} },
    execution: { clock: { maximum_clock_skew: "30s" } },
    targets: {},
    providers: {
      telemetry: {
        metrics: { endpoint: "https://prometheus.example.test" },
        logs: { endpoint: "https://loki.example.test" },
        traces: { endpoint: "https://tempo.example.test" },
        grafana: { endpoint: "https://grafana.example.test" }
      }
    },
    gates: { pre_deployment: [], post_deployment: [] },
    reporting: {},
    security: {},
    limits: { maximum_provider_response_size: "2MiB" }
  };
}

describe("fake observability stack", () => {
  it("drives live metric evidence through the guarded provider and deduplicates requests", async () => {
    const stack = new FakeObservabilityStack();
    const session = createPolicyProviderSession({
      policy: policy(),
      workspaceRoot: process.cwd(),
      environment: {},
      fetch: stack.fetch,
      resolveHostname: async () => ["203.0.113.10"],
      clock: () => now
    });
    const store = new EvidenceStore(() => new Date(now));
    const context = {
      phase: "pre_deployment" as const,
      targetId: "checkout-production",
      releaseId: "release-candidate",
      evidenceStore: store,
      signal: new AbortController().signal,
      clock: () => new Date(now)
    };
    const definition = {
      id: "risk.error-rate",
      source: { provider: "metrics", query: "sum(rate(http_requests_total[5m]))" },
      assertions: { operator: "less_than", threshold: 0.02 }
    };

    const [first, second] = await Promise.all([
      session.resolveEvidence?.("metric.threshold", definition, context),
      session.resolveEvidence?.("metric.threshold", definition, context)
    ]);

    expect(first?.[0]?.state).toBe("valid");
    expect(first?.[0]?.value).toMatchObject({ value: 0.01, sampleCount: 1 });
    expect(second?.[0]?.id).toBe(first?.[0]?.id);
    expect(stack.requestCount("prometheus.example.test", "/api/v1/query")).toBe(1);
    expect(stack.maximumConcurrency()).toBe(1);
  });

  it("turns malformed provider JSON into invalid evidence", async () => {
    const stack = new FakeObservabilityStack("malformed");
    const session = createPolicyProviderSession({
      policy: policy(),
      workspaceRoot: process.cwd(),
      environment: {},
      fetch: stack.fetch,
      resolveHostname: async () => ["203.0.113.10"],
      clock: () => now
    });
    const evidence = await session.resolveEvidence?.(
      "metric.threshold",
      {
        source: { provider: "metrics", query: "up" },
        assertions: { operator: "equal", threshold: 1 }
      },
      {
        phase: "pre_deployment",
        targetId: "checkout-production",
        evidenceStore: new EvidenceStore(() => new Date(now)),
        signal: new AbortController().signal,
        clock: () => new Date(now)
      }
    );

    expect(evidence?.[0]?.state).toBe("invalid");
    expect(evidence?.[0]?.diagnostics[0]?.code).toBe("PROVIDER_PROTOCOL");
  });
});
