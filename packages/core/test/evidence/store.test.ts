import { describe, expect, it, vi } from "vitest";
import {
  EvidenceStore,
  fingerprintEvidenceRequest,
  type Evidence,
  type EvidenceRequest
} from "../../src/index.js";

const request: EvidenceRequest = {
  kind: "metrics.vector",
  provider: "metrics",
  capability: "query",
  target: "aks-checkout",
  releaseId: "release-1",
  range: {
    start: "2026-10-06T07:20:00.000Z",
    end: "2026-10-06T07:30:00.000Z",
    stepMs: 30_000
  },
  query: "sum( rate(http_requests_total[5m]) )"
};

function validEvidence(value: number): Evidence<number> {
  return {
    id: "evidence-1",
    kind: "metrics.vector",
    state: "valid",
    source: { provider: "metrics", capability: "query" },
    target: "aks-checkout",
    releaseId: "release-1",
    acquiredAt: "2026-10-06T07:30:00.000Z",
    observedAt: "2026-10-06T07:29:30.000Z",
    value,
    diagnostics: []
  };
}

describe("fingerprintEvidenceRequest", () => {
  it("is stable across object-key order and normalized query whitespace", () => {
    const first = fingerprintEvidenceRequest({
      ...request,
      parameters: { environment: "production", service: "checkout" }
    });
    const second = fingerprintEvidenceRequest({
      parameters: { service: "checkout", environment: "production" },
      query: "sum(rate(http_requests_total[5m]))",
      range: request.range,
      releaseId: request.releaseId,
      target: request.target,
      capability: request.capability,
      provider: request.provider,
      kind: request.kind
    });

    expect(first).toBe(second);
  });

  it.each(["provider", "capability", "target", "releaseId", "range", "query"] as const)(
    "changes when %s changes",
    (field) => {
      const changed: EvidenceRequest = {
        ...request,
        ...(field === "provider" ? { provider: "other" } : {}),
        ...(field === "capability" ? { capability: "range-query" } : {}),
        ...(field === "target" ? { target: "aca-order" } : {}),
        ...(field === "releaseId" ? { releaseId: "release-2" } : {}),
        ...(field === "range" ? { range: { ...request.range, stepMs: 60_000 } } : {}),
        ...(field === "query" ? { query: "up" } : {})
      };

      expect(fingerprintEvidenceRequest(changed)).not.toBe(fingerprintEvidenceRequest(request));
    }
  );

  it("does not let credential values affect a fingerprint", () => {
    const first = fingerprintEvidenceRequest({
      ...request,
      parameters: { authorization: "Bearer first" }
    });
    const second = fingerprintEvidenceRequest({
      ...request,
      parameters: { authorization: "Bearer second" }
    });

    expect(first).toBe(second);
  });

  it.each([
    [String.raw`up{job="a b"}`, String.raw`up{job="a  b"}`],
    [String.raw`logs{message="a\" b"}`, String.raw`logs{message="a\"  b"}`],
    [String.raw`logs{path="C:\temp"}`, String.raw`logs{path="C:\\temp"}`]
  ])("preserves distinct quoted query literals", (firstQuery, secondQuery) => {
    expect(fingerprintEvidenceRequest({ ...request, query: firstQuery })).not.toBe(
      fingerprintEvidenceRequest({ ...request, query: secondQuery })
    );
  });
});

describe("EvidenceStore", () => {
  it("shares one in-flight load for concurrent identical requests", async () => {
    const store = new EvidenceStore(() => new Date("2026-10-06T07:30:00.000Z"));
    const loader = vi.fn(async () => validEvidence(42));

    const [first, second] = await Promise.all([
      store.getOrLoad(request, loader),
      store.getOrLoad({ ...request }, loader)
    ]);

    expect(first.value).toBe(42);
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("limits successful caching to one store lifetime", async () => {
    const loader = vi.fn(async () => validEvidence(7));

    await new EvidenceStore().getOrLoad(request, loader);
    await new EvidenceStore().getOrLoad(request, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("loads semantically distinct quoted queries independently", async () => {
    const store = new EvidenceStore(() => new Date("2026-10-06T07:30:00.000Z"));
    const loader = vi.fn(async () => validEvidence(42));

    await store.getOrLoad({ ...request, query: String.raw`up{job="a b"}` }, loader);
    await store.getOrLoad({ ...request, query: String.raw`up{job="a  b"}` }, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("converts a rejected load to unavailable without exposing its cause", async () => {
    const store = new EvidenceStore(() => new Date("2026-10-06T07:30:00.000Z"));

    const evidence = await store.getOrLoad(request, async () => {
      throw new Error("Authorization: Bearer secret-token");
    });
    const serialized = JSON.stringify(evidence);

    expect(evidence.state).toBe("unavailable");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("Bearer");
  });
});
