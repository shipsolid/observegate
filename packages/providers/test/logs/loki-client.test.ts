import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GateError } from "@observability-gate/core";
import { LokiClient, type TransportRequest, type TransportResponse } from "../../src/index.js";

const now = Date.parse("2026-10-06T08:00:30.000Z");

async function fixture(name: string): Promise<unknown> {
  const path = fileURLToPath(
    new URL(`../../../../fixtures/providers/loki/${name}.json`, import.meta.url)
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
  return new LokiClient({
    endpoint: "https://logs.example.com/loki",
    provider: "loki-primary",
    transport,
    maximumLimit: 100,
    maximumRangeMs: 60 * 60 * 1000,
    clock: () => now
  });
}

const request = {
  query: '{service_name="checkout",deployment_environment="production"}',
  target: "prod-checkout",
  start: "2026-10-06T07:59:00.000Z",
  end: "2026-10-06T08:00:00.000Z",
  direction: "backward" as const,
  limit: 500,
  minimumRecords: 1,
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 5_000,
  structuredMetadataFields: ["level"]
};

describe("LokiClient", () => {
  it("normalizes streams and selected metadata without retaining log bodies", async () => {
    const transport = transportWith(await fixture("streams"));
    const evidence = await client(transport).queryRange(request);

    expect(evidence).toMatchObject({
      kind: "logs.records",
      state: "valid",
      observedAt: "2026-10-06T08:00:00.000Z",
      value: {
        recordCount: 1,
        records: [
          {
            timestamp: "2026-10-06T08:00:00.000Z",
            labels: {
              service_name: "checkout",
              deployment_environment: "production"
            },
            structuredMetadata: { level: "error" },
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            spanId: "00f067aa0ba902b7",
            byteCount: 33
          }
        ],
        warnings: ["results reached the configured limit"]
      }
    });
    expect(JSON.stringify(evidence)).not.toContain("customer email");
    expect(JSON.stringify(evidence)).not.toContain("customer_id");
    expect(evidence.diagnostics).toEqual([
      expect.objectContaining({ message: "results reached the configured limit" })
    ]);

    const outbound = transport.request.mock.calls[0]?.[0];
    const outboundUrl = new URL(String(outbound?.url));
    expect(outboundUrl.pathname).toBe("/loki/api/v1/query_range");
    expect(outboundUrl.searchParams.get("limit")).toBe("100");
    expect(outboundUrl.searchParams.get("direction")).toBe("backward");
    expect(outboundUrl.searchParams.get("start")).toBe("1791273540000000000");
  });

  it("returns missing for empty streams and stale for old records", async () => {
    const missing = await client(
      transportWith({ status: "success", data: { resultType: "streams", result: [] } })
    ).queryRange(request);
    expect(missing.state).toBe("missing");

    const stale = await client(
      transportWith({
        status: "success",
        data: {
          resultType: "streams",
          result: [{ stream: {}, values: [["1791266400000000000", "old"]] }]
        }
      })
    ).queryRange(request);
    expect(stale.state).toBe("stale");
  });

  it("classifies malformed nanosecond timestamps as invalid", async () => {
    const evidence = await client(transportWith(await fixture("malformed"))).queryRange(request);
    expect(evidence.state).toBe("invalid");
    expect(evidence.value).toBeUndefined();
  });

  it("rejects unbounded selectors and invalid range inputs before transport", async () => {
    const transport = transportWith({});
    const loki = client(transport);
    await expect(loki.queryRange({ ...request, query: "{}" })).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
    await expect(
      loki.queryRange({ ...request, query: '{service_name=~".*"}' })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    await expect(
      loki.queryRange({ ...request, start: "2026-10-05T00:00:00.000Z" })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    expect(transport.request).not.toHaveBeenCalled();
  });

  it("maps provider failures and propagates cancellation", async () => {
    const failure = new GateError({
      code: "PROVIDER_UNAVAILABLE",
      safeMessage: "loki unavailable",
      retryable: true
    });
    const failed = client({ request: vi.fn(async () => Promise.reject(failure)) });
    await expect(failed.queryRange(request)).resolves.toMatchObject({ state: "unavailable" });

    const cancellation = new GateError({
      code: "CANCELLED",
      safeMessage: "cancelled",
      retryable: false
    });
    const cancelled = client({ request: vi.fn(async () => Promise.reject(cancellation)) });
    await expect(cancelled.queryRange(request)).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
