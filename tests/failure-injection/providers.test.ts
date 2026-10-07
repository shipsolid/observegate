import {
  GrafanaClient,
  GuardedTransport,
  HttpProbe,
  LokiClient,
  PrometheusMetricsProvider,
  TempoClient,
  UrlPolicy,
  type FetchLike
} from "@observability-gate/providers";
import { describe, expect, it, vi } from "vitest";

type Scenario =
  | "timeout"
  | "connection-reset"
  | "429"
  | "502"
  | "503"
  | "504"
  | "401"
  | "403"
  | "malformed"
  | "partial"
  | "oversized"
  | "cancellation";

type ProviderName = "prometheus" | "loki" | "tempo" | "grafana" | "http";

const scenarios: readonly Scenario[] = [
  "timeout",
  "connection-reset",
  "429",
  "502",
  "503",
  "504",
  "401",
  "403",
  "malformed",
  "partial",
  "oversized",
  "cancellation"
];
const providers: readonly ProviderName[] = ["prometheus", "loki", "tempo", "grafana", "http"];

function fakeFor(scenario: Scenario): FetchLike {
  if (scenario === "timeout") {
    return async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
  }
  if (scenario === "connection-reset") {
    return async () => {
      throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    };
  }
  if (/^\d{3}$/u.test(scenario)) {
    return async () => new Response("provider failure", { status: Number(scenario) });
  }
  if (scenario === "malformed") {
    return async () => new Response("{not-json", { status: 200 });
  }
  if (scenario === "oversized") {
    return async () =>
      Response.json({ value: "x".repeat(1024) }, { headers: { "content-length": "2048" } });
  }
  return async () => Response.json({});
}

function transport(scenario: Scenario): GuardedTransport {
  return new GuardedTransport({
    urlPolicy: new UrlPolicy({
      providerOrigins: ["https://api.example.com"],
      probeHosts: ["probe.example.com"],
      resolve: async () => ["93.184.216.34"]
    }),
    fetch: fakeFor(scenario),
    sleep: async () => undefined,
    random: () => 0,
    clock: () => Date.parse("2026-10-06T00:00:00.000Z")
  });
}

async function acquire(provider: ProviderName, scenario: Scenario) {
  const controller = new AbortController();
  if (scenario === "cancellation") controller.abort();
  const shared = transport(scenario);
  const common = {
    target: "checkout-production",
    maximumAgeMs: 60_000,
    maximumFutureSkewMs: 30_000,
    signal: controller.signal
  };
  if (provider === "prometheus") {
    return new PrometheusMetricsProvider({
      endpoint: "https://api.example.com",
      provider: "metrics",
      transport: shared,
      maximumRangeMs: 60_000,
      timeoutMs: 2,
      maximumResponseBytes: 64
    }).queryInstant({ ...common, query: "up", minimumSamples: 1 });
  }
  if (provider === "loki") {
    return new LokiClient({
      endpoint: "https://api.example.com",
      provider: "logs",
      transport: shared,
      maximumLimit: 10,
      maximumRangeMs: 60_000,
      timeoutMs: 2,
      maximumResponseBytes: 64
    }).queryRange({
      ...common,
      query: '{service="checkout"}',
      start: "2026-10-05T23:59:30.000Z",
      end: "2026-10-06T00:00:00.000Z",
      direction: "backward",
      limit: 10,
      minimumRecords: 1
    });
  }
  if (provider === "tempo") {
    return new TempoClient({
      endpoint: "https://api.example.com",
      provider: "traces",
      transport: shared,
      maximumLimit: 10,
      maximumRangeMs: 60_000,
      timeoutMs: 2,
      maximumResponseBytes: 64
    }).search({
      ...common,
      service: { name: "checkout" },
      start: "2026-10-05T23:59:30.000Z",
      end: "2026-10-06T00:00:00.000Z",
      limit: 10,
      minimumTraces: 1,
      trafficObserved: true,
      samplingProbability: 1
    });
  }
  if (provider === "grafana") {
    return new GrafanaClient({
      endpoint: "https://api.example.com",
      provider: "grafana",
      transport: shared,
      timeoutMs: 2,
      maximumResponseBytes: 64
    }).getDashboard({ ...common, uid: "checkout" });
  }
  return new HttpProbe({ transport: shared }).check({
    url: "https://probe.example.com/ready",
    method: "GET",
    expectedStatus: 200,
    expectedJson: { status: "ok" },
    timeoutMs: 2,
    maximumResponseBytes: 64,
    signal: controller.signal
  });
}

describe("network provider failure injection", () => {
  it.each(
    providers.flatMap((provider) => scenarios.map((scenario) => [provider, scenario] as const))
  )("%s handles %s without returning valid evidence", async (provider, scenario) => {
    if (scenario === "cancellation") {
      await expect(acquire(provider, scenario)).rejects.toMatchObject({ code: "CANCELLED" });
      return;
    }
    const evidence = await acquire(provider, scenario);
    expect(evidence.state).not.toBe("valid");
    if (evidence.diagnostics[0] !== undefined) {
      expect(evidence.diagnostics[0].code).toMatch(
        /^(?:AUTHENTICATION|AUTHORIZATION|PROVIDER_PROTOCOL|PROVIDER_UNAVAILABLE|EVIDENCE_INVALID)$/u
      );
    }
  });

  it("retries only the configured transient status classes", async () => {
    const calls = vi.fn(async () => new Response("busy", { status: 503 }));
    const guarded = new GuardedTransport({
      urlPolicy: new UrlPolicy({
        providerOrigins: ["https://api.example.com"],
        probeHosts: [],
        resolve: async () => ["93.184.216.34"]
      }),
      fetch: calls as FetchLike,
      sleep: async () => undefined,
      random: () => 0
    });

    await expect(
      guarded.request({
        url: "https://api.example.com/data",
        kind: "provider",
        timeoutMs: 100,
        maximumResponseBytes: 64,
        retry: {
          attempts: 3,
          initialBackoffMs: 1,
          maximumBackoffMs: 2,
          retryStatuses: [429, 502, 503, 504]
        },
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(calls).toHaveBeenCalledTimes(3);
  });
});
