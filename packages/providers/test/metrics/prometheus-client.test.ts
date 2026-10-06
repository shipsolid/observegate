import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GateError } from "@observability-gate/core";
import {
  PrometheusMetricsProvider,
  guardPrometheusQuery,
  type TransportRequest,
  type TransportResponse
} from "../../src/index.js";

const now = Date.parse("2026-10-06T08:00:30.000Z");

async function fixture(name: string): Promise<unknown> {
  const path = fileURLToPath(
    new URL(`../../../../fixtures/providers/prometheus/${name}.json`, import.meta.url)
  );
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function transportWith(data: unknown, status = 200) {
  const request = vi.fn(async (): Promise<TransportResponse> => ({
    status,
    data,
    attempts: 1,
    headers: new Headers()
  }));
  return { request };
}

function provider(transport: {
  request: (request: TransportRequest) => Promise<TransportResponse>;
}) {
  return new PrometheusMetricsProvider({
    endpoint: "https://prom.example.com/prometheus",
    provider: "mimir-primary",
    transport,
    clock: () => now,
    identityLabels: {
      serviceName: "service_name",
      serviceNamespace: "service_namespace",
      serviceVersion: "service_version",
      deploymentEnvironment: "deployment_environment"
    },
    maximumRangeMs: 24 * 60 * 60 * 1000
  });
}

const instantRequest = {
  query: 'up{service_name="checkout",deployment_environment="production"}',
  target: "prod-checkout",
  minimumSamples: 1,
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 5_000,
  requireProductionScope: true
} as const;

describe("PrometheusMetricsProvider", () => {
  it("normalizes vectors, canonical identity, warnings, and query fingerprints", async () => {
    const transport = transportWith(await fixture("vector"));
    const evidence = await provider(transport).queryInstant(instantRequest);

    expect(evidence).toMatchObject({
      kind: "metrics.vector",
      state: "valid",
      target: "prod-checkout",
      observedAt: "2026-10-06T08:00:00.000Z",
      source: {
        provider: "mimir-primary",
        capability: "metrics.query.instant",
        queryFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u)
      },
      value: {
        resultType: "vector",
        sampleCount: 1,
        warnings: ["results are partial"],
        samples: [
          {
            value: 12.5,
            identity: {
              serviceName: "checkout",
              serviceNamespace: "shop",
              serviceVersion: "2026.10.6",
              deploymentEnvironment: "production"
            }
          }
        ]
      }
    });
    expect(evidence.diagnostics).toEqual([
      expect.objectContaining({ code: "PROVIDER_PROTOCOL", message: "results are partial" })
    ]);
    expect(JSON.stringify(evidence)).not.toContain(instantRequest.query);

    const outbound = transport.request.mock.calls[0]?.[0];
    expect(String(outbound?.url)).toContain("/api/v1/query?");
    expect(outbound?.method).toBe("GET");
  });

  it("normalizes range matrices with query boundaries and step", async () => {
    const evidence = await provider(transportWith(await fixture("matrix"))).queryRange({
      ...instantRequest,
      start: "2026-10-06T07:59:00.000Z",
      end: "2026-10-06T08:00:00.000Z",
      stepMs: 30_000
    });

    expect(evidence).toMatchObject({
      kind: "metrics.matrix",
      state: "valid",
      value: {
        resultType: "matrix",
        sampleCount: 3,
        range: {
          start: "2026-10-06T07:59:00.000Z",
          end: "2026-10-06T08:00:00.000Z",
          stepMs: 30_000
        },
        series: [{ samples: [{ value: 10 }, { value: 11 }, { value: 12 }] }]
      }
    });
  });

  it("supports scalar results without inventing metric labels", async () => {
    const evidence = await provider(
      transportWith({
        status: "success",
        data: { resultType: "scalar", result: [1791273600, "42"] }
      })
    ).queryInstant(instantRequest);

    expect(evidence).toMatchObject({
      state: "valid",
      value: {
        resultType: "vector",
        sampleCount: 1,
        samples: [{ labels: {}, value: 42 }]
      }
    });
  });

  it("classifies valid empty results as missing", async () => {
    const evidence = await provider(
      transportWith({ status: "success", data: { resultType: "vector", result: [] } })
    ).queryInstant(instantRequest);

    expect(evidence).toMatchObject({ state: "missing", value: { sampleCount: 0, samples: [] } });
  });

  it.each(["NaN", "+Inf", "-Inf"])("classifies %s samples as invalid", async (value) => {
    const evidence = await provider(
      transportWith({
        status: "success",
        data: { resultType: "vector", result: [{ metric: {}, value: [1791273600, value] }] }
      })
    ).queryInstant(instantRequest);

    expect(evidence.state).toBe("invalid");
    expect(evidence.value).toBeUndefined();
  });

  it("classifies malformed tuples as invalid", async () => {
    const evidence = await provider(transportWith(await fixture("malformed"))).queryInstant(
      instantRequest
    );
    expect(evidence).toMatchObject({ state: "invalid" });
  });

  it("classifies stale and future timestamps", async () => {
    const stale = await provider(
      transportWith({
        status: "success",
        data: { resultType: "vector", result: [{ metric: {}, value: [1791270000, "1"] }] }
      })
    ).queryInstant(instantRequest);
    expect(stale.state).toBe("stale");

    const future = await provider(
      transportWith({
        status: "success",
        data: { resultType: "vector", result: [{ metric: {}, value: [1791273700, "1"] }] }
      })
    ).queryInstant(instantRequest);
    expect(future.state).toBe("invalid");
  });

  it("maps HTTP, timeout, and oversized-response failures to typed evidence", async () => {
    for (const error of [
      new GateError({
        code: "AUTHENTICATION",
        safeMessage: "authentication rejected",
        retryable: false
      }),
      new GateError({
        code: "PROVIDER_UNAVAILABLE",
        safeMessage: "request timed out",
        retryable: true
      }),
      new GateError({
        code: "PROVIDER_PROTOCOL",
        safeMessage: "response exceeded size limit",
        retryable: false
      })
    ]) {
      const transport = { request: vi.fn(async () => Promise.reject(error)) };
      const evidence = await provider(transport).queryInstant(instantRequest);
      expect(evidence.state).toBe(error.code === "PROVIDER_PROTOCOL" ? "invalid" : "unavailable");
      expect(evidence.diagnostics).toEqual([error.toDiagnostic()]);
    }
  });

  it("uses POST form encoding once the encoded GET URL exceeds 4 KiB", async () => {
    const transport = transportWith({
      status: "success",
      data: { resultType: "vector", result: [] }
    });
    const longQuery = `up{service_name="checkout",deployment_environment="production",padding="${"x".repeat(4_100)}"}`;

    await provider(transport).queryInstant({ ...instantRequest, query: longQuery });

    const outbound = transport.request.mock.calls[0]?.[0];
    expect(outbound?.method).toBe("POST");
    expect(outbound?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded"
    });
    expect(String(outbound?.body)).toContain("query=");
    expect(String(outbound?.url)).not.toContain("query=");
  });

  it("returns insufficient evidence for a low-traffic candidate", async () => {
    const samples = Array.from({ length: 12 }, (_, index) => [1791273570 + index, String(index)]);
    const evidence = await provider(
      transportWith({
        status: "success",
        data: { resultType: "matrix", result: [{ metric: {}, values: samples }] }
      })
    ).queryRange({
      ...instantRequest,
      start: "2026-10-06T07:59:00.000Z",
      end: "2026-10-06T08:00:00.000Z",
      stepMs: 1_000,
      minimumSamples: 200
    });

    expect(evidence).toMatchObject({ state: "insufficient", value: { sampleCount: 12 } });
  });
});

describe("guardPrometheusQuery", () => {
  it("rejects oversized queries, excessive ranges, sub-second steps, and unscoped production selectors", () => {
    expect(() =>
      guardPrometheusQuery({
        query: "x".repeat(16 * 1024 + 1),
        maximumQueryLength: 16 * 1024
      })
    ).toThrowError(expect.objectContaining({ code: "SECURITY_POLICY" }));

    expect(() =>
      guardPrometheusQuery({
        query: 'up{service_name="checkout",deployment_environment="production"}',
        startMs: 0,
        endMs: 10_000,
        maximumRangeMs: 5_000,
        stepMs: 1_000
      })
    ).toThrowError(expect.objectContaining({ code: "SECURITY_POLICY" }));

    expect(() =>
      guardPrometheusQuery({ query: "up", startMs: 0, endMs: 10_000, stepMs: 999 })
    ).toThrowError(expect.objectContaining({ code: "SECURITY_POLICY" }));

    expect(() =>
      guardPrometheusQuery({
        query: 'up{service_name="checkout"}',
        requiredScopeLabels: ["service_name", "deployment_environment"]
      })
    ).toThrowError(expect.objectContaining({ code: "SECURITY_POLICY" }));
  });
});
