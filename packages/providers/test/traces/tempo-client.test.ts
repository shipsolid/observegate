import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GateError } from "@observability-gate/core";
import { TempoClient, type TransportRequest, type TransportResponse } from "../../src/index.js";

const now = Date.parse("2026-10-06T08:00:30.000Z");

async function fixture(name: string): Promise<unknown> {
  const path = fileURLToPath(
    new URL(`../../../../fixtures/providers/tempo/${name}.json`, import.meta.url)
  );
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function transportWith(data: unknown) {
  const request = vi.fn(async (): Promise<TransportResponse> => ({
    status: 200,
    data,
    attempts: 1,
    headers: new Headers()
  }));
  return { request };
}

function client(transport: { request: (request: TransportRequest) => Promise<TransportResponse> }) {
  return new TempoClient({
    endpoint: "https://traces.example.com/tempo",
    provider: "tempo-primary",
    transport,
    maximumLimit: 100,
    maximumRangeMs: 60 * 60 * 1000,
    clock: () => now
  });
}

const request = {
  target: "prod-checkout",
  service: {
    name: "checkout",
    namespace: "shop",
    version: "2026.10.6",
    environment: "production"
  },
  start: "2026-10-06T07:59:00.000Z",
  end: "2026-10-06T08:00:00.000Z",
  limit: 200,
  minimumTraces: 1,
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 5_000,
  trafficObserved: true,
  samplingProbability: 1
};

describe("TempoClient", () => {
  it("searches canonical resources and normalizes trace, span, error, and peer evidence", async () => {
    const transport = transportWith(await fixture("search"));
    const evidence = await client(transport).search(request);

    expect(evidence).toMatchObject({
      kind: "traces.summaries",
      state: "valid",
      observedAt: "2026-10-06T08:00:00.000Z",
      value: {
        traceCount: 1,
        warnings: ["trace is partial"],
        traces: [
          {
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            rootServiceName: "checkout",
            rootTraceName: "POST /orders",
            durationMs: 245.5,
            partial: true,
            identity: {
              serviceName: "checkout",
              serviceNamespace: "shop",
              serviceVersion: "2026.10.6",
              deploymentEnvironment: "production"
            },
            spans: [
              {
                spanId: "00f067aa0ba902b7",
                name: "POST /orders",
                kind: "SERVER",
                status: "ERROR",
                peerService: "payments"
              }
            ]
          }
        ]
      }
    });

    const outbound = transport.request.mock.calls[0]?.[0];
    const url = new URL(String(outbound?.url));
    expect(url.searchParams.get("q")).toContain('resource.service.name = "checkout"');
    expect(url.searchParams.get("q")).toContain(
      'resource.deployment.environment.name = "production"'
    );
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("distinguishes empty search from sampling-aware absence", async () => {
    const empty = transportWith({ traces: [] });
    await expect(client(empty).search(request)).resolves.toMatchObject({ state: "missing" });
    await expect(
      client(empty).search({ ...request, samplingProbability: 0.1 })
    ).resolves.toMatchObject({ state: "insufficient" });
    await expect(
      client(empty).search({ ...request, trafficObserved: false, samplingProbability: 0.1 })
    ).resolves.toMatchObject({ state: "missing" });
  });

  it("classifies malformed, stale, and insufficient trace results", async () => {
    await expect(
      client(transportWith(await fixture("malformed"))).search(request)
    ).resolves.toMatchObject({ state: "invalid" });

    const stalePayload = {
      traces: [
        {
          traceID: "abc",
          startTimeUnixNano: "1791266400000000000",
          durationMs: 1,
          resource: {},
          spans: []
        }
      ]
    };
    await expect(client(transportWith(stalePayload)).search(request)).resolves.toMatchObject({
      state: "stale"
    });
    await expect(
      client(transportWith(await fixture("search"))).search({ ...request, minimumTraces: 5 })
    ).resolves.toMatchObject({ state: "insufficient" });
  });

  it("rejects invalid bounds and maps provider failures", async () => {
    const transport = transportWith({});
    await expect(
      client(transport).search({ ...request, start: "2026-10-05T00:00:00.000Z" })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    expect(transport.request).not.toHaveBeenCalled();

    const failure = new GateError({
      code: "AUTHORIZATION",
      safeMessage: "forbidden",
      retryable: false
    });
    await expect(
      client({ request: vi.fn(async () => Promise.reject(failure)) }).search(request)
    ).resolves.toMatchObject({ state: "unavailable" });
  });
});
