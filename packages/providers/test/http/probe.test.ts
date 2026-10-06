import { describe, expect, it, vi } from "vitest";
import { GateError } from "@observability-gate/core";
import { HttpProbe, type TransportResponse } from "../../src/index.js";

function probeWith(response: TransportResponse | Error) {
  const request = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return { probe: new HttpProbe({ transport: { request } }), request };
}

const request = {
  url: "https://probe.example.com/ready",
  method: "GET" as const,
  expectedStatus: 200,
  expectedHeaders: { "x-release-id": "2026.10.6" },
  expectedJson: { status: "ready", version: "2026.10.6" },
  timeoutMs: 1_000,
  maximumResponseBytes: 1_024,
  signal: new AbortController().signal
};

describe("HttpProbe", () => {
  it("compares status, release headers, and exact shallow JSON without retaining the body", async () => {
    const { probe } = probeWith({
      status: 200,
      data: { status: "ready", version: "2026.10.6", nested: { ignored: true } },
      attempts: 1,
      headers: new Headers({ "x-release-id": "2026.10.6" })
    });
    const evidence = await probe.check(request);
    expect(evidence).toMatchObject({
      state: "valid",
      value: { status: 200, statusMatches: true, headersMatch: true, jsonMatches: true }
    });
    expect(JSON.stringify(evidence)).not.toContain("nested");
  });

  it("reports wrong status, release header, invalid JSON, timeout, and oversized responses", async () => {
    const mismatch = probeWith({
      status: 201,
      data: "not-json",
      attempts: 1,
      headers: new Headers({ "x-release-id": "old" })
    }).probe;
    await expect(mismatch.check(request)).resolves.toMatchObject({
      state: "invalid",
      value: { statusMatches: false, headersMatch: false, jsonMatches: false }
    });

    for (const message of [
      "request timed out",
      "response exceeded size limit",
      "TLS handshake failed"
    ]) {
      const error = new GateError({
        code: message.includes("size") ? "PROVIDER_PROTOCOL" : "PROVIDER_UNAVAILABLE",
        safeMessage: message,
        retryable: !message.includes("size")
      });
      await expect(probeWith(error).probe.check(request)).resolves.toMatchObject({
        state: message.includes("size") ? "invalid" : "unavailable"
      });
    }
  });

  it("propagates forbidden redirects/addresses and cancellation", async () => {
    for (const code of ["SECURITY_POLICY", "CANCELLED"] as const) {
      const error = new GateError({ code, safeMessage: code, retryable: false });
      await expect(probeWith(error).probe.check(request)).rejects.toMatchObject({ code });
    }
  });

  it("supports HEAD without requesting a response body", async () => {
    const { probe, request: transport } = probeWith({
      status: 200,
      data: undefined,
      attempts: 1,
      headers: new Headers()
    });
    await expect(
      probe.check({ ...request, method: "HEAD", expectedHeaders: {}, expectedJson: undefined })
    ).resolves.toMatchObject({ state: "valid" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ method: "HEAD", responseType: "none" })
    );
  });
});
