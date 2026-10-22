import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EvidenceStore, type Evidence } from "@observability-gate/core";
import { GateCatalog, registerPostCommonGates, type GateContext } from "../../../src/index.js";

const referenceTypes = [
  ["workload.provisioned", "runtime.provisioned"],
  ["workload.ready", "runtime.ready"],
  ["workload.release", "runtime.release_identity"],
  ["release.traffic", "metric.threshold", "workload_identity"],
  ["telemetry.metrics-presence", "telemetry.presence", "telemetry_presence"],
  ["telemetry.logs-presence", "telemetry.presence", "telemetry_presence"],
  ["telemetry.traces-presence", "telemetry.presence", "telemetry_presence"],
  ["telemetry.freshness", "telemetry.freshness", "telemetry_freshness"],
  ["telemetry.contract", "telemetry.contract"],
  ["telemetry.identity-consistency", "telemetry.identity_consistency"],
  ["telemetry.trace-log-correlation", "telemetry.correlation"],
  ["telemetry.service-graph", "telemetry.service_graph"],
  ["telemetry.pipeline-health", "telemetry.collector_health"],
  ["release.error-rate", "metric.threshold", "error_rate"],
  ["release.latency", "metric.threshold", "latency"],
  ["release.availability", "metric.threshold", "availability"],
  ["release.throughput", "metric.threshold"],
  ["release.saturation", "metric.multi_threshold"],
  ["release.stability", "runtime.stability"]
] as const;

const context: GateContext = {
  phase: "post_deployment",
  targetId: "prod-checkout",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date("2026-10-06T08:10:00.000Z"),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};

async function fixture() {
  return JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../../fixtures/repositories/post-common-pass/evidence.json",
          import.meta.url
        )
      ),
      "utf8"
    )
  ) as Record<string, Readonly<Record<string, unknown>>>;
}

function evidence(type: string, value: Readonly<Record<string, unknown>>): Evidence<unknown> {
  return {
    id: `${type}-evidence`,
    kind: type,
    state: "valid",
    source: { provider: "fixture", capability: type },
    target: context.targetId,
    acquiredAt: context.clock().toISOString(),
    value,
    diagnostics: []
  };
}

function assertionsFor(type: string, value: Readonly<Record<string, unknown>>) {
  const catalog = registerPostCommonGates(new GateCatalog());
  return catalog.require(type, "post_deployment", {}).evaluate([evidence(type, value)], context);
}

describe("common post-deployment gate catalogue", () => {
  it("resolves every reference gate and preserves required category declarations", () => {
    const catalog = registerPostCommonGates(new GateCatalog());
    for (const [id, type, category] of referenceTypes) {
      const resolved = catalog.require(type, "post_deployment", { id, category });
      expect(resolved.metadata.type).toBe(type);
      if (category !== undefined) expect(resolved.definition).toMatchObject({ category });
    }
  });

  it("passes a complete healthy post-deployment fixture", async () => {
    const values = await fixture();
    for (const [, type] of referenceTypes) {
      const results = assertionsFor(type, values[type] ?? {});
      expect(results.length, type).toBeGreaterThan(0);
      expect(
        results.every((result) => result.status === "passed"),
        type
      ).toBe(true);
    }
  });

  it("fails runtime and telemetry identity disagreement with sanitized observed IDs", () => {
    const releaseResults = assertionsFor("runtime.release_identity", {
      runtime: { releaseId: "runtime-123<script>" },
      attestation: { releaseId: "attested-456" },
      expected: { releaseId: "expected-789" }
    });
    const telemetryResults = assertionsFor("telemetry.identity_consistency", {
      expectedReleaseId: "expected-789",
      identities: [
        { source: "runtime", releaseId: "runtime-123<script>", consistent: false },
        { source: "metrics", releaseId: "metrics-456", consistent: false },
        { source: "attestation", releaseId: "attested-789", consistent: false }
      ]
    });
    expect(releaseResults.some((result) => result.status === "failed")).toBe(true);
    expect(telemetryResults.some((result) => result.status === "failed")).toBe(true);
    const serialized = JSON.stringify([releaseResults, telemetryResults]);
    expect(serialized).toContain("runtime-123?script?");
    expect(serialized).not.toContain("<script>");
  });

  it("requires all identity sources and compares full identities before display sanitization", () => {
    for (const runtime of [
      undefined,
      { releaseId: "candidate?" },
      { releaseId: "a".repeat(128) + "x" }
    ]) {
      const expected = runtime?.releaseId?.startsWith("a") ? "a".repeat(128) + "y" : "candidate!";
      expect(
        assertionsFor("runtime.release_identity", {
          runtime,
          attestation: { releaseId: expected },
          expected: { releaseId: expected }
        }).some((result) => result.status !== "passed")
      ).toBe(true);
    }
    expect(
      assertionsFor("telemetry.identity_consistency", {
        identities: [{ source: "runtime", consistent: true }]
      }).some((result) => result.status !== "passed")
    ).toBe(true);
    expect(
      assertionsFor("telemetry.identity_consistency", {
        expectedReleaseId: "candidate!",
        identities: [{ source: "runtime", releaseId: "candidate?", consistent: true }]
      }).some((result) => result.status !== "passed")
    ).toBe(true);
  });

  it("requires each mandatory telemetry identity source", () => {
    expect(
      assertionsFor("telemetry.identity_consistency", {
        expectedReleaseId: "candidate",
        identities: [{ source: "runtime", releaseId: "candidate", consistent: true }]
      }).some((result) => result.status !== "passed")
    ).toBe(true);
  });

  it("requires policy-mandated release digest fields even when all evidence omits them", () => {
    const catalog = registerPostCommonGates(new GateCatalog());
    const results = catalog
      .require("runtime.release_identity", "post_deployment", {
        assertions: { expected_image_digest_env: "IMAGE_DIGEST" }
      })
      .evaluate(
        [
          evidence("runtime.release_identity", {
            runtime: { releaseId: "candidate" },
            attestation: { releaseId: "candidate" },
            expected: { releaseId: "candidate" }
          })
        ],
        context
      );
    expect(results).toContainEqual(
      expect.objectContaining({ assertion: "image digest", status: "failed" })
    );
  });

  it("reports each stale signal independently", () => {
    const results = assertionsFor("telemetry.freshness", {
      signals: [
        {
          name: "metrics",
          ageMs: 1000,
          maximumAgeMs: 2000,
          futureSkewMs: 0,
          maximumFutureSkewMs: 100
        },
        {
          name: "logs",
          ageMs: 3000,
          maximumAgeMs: 2000,
          futureSkewMs: 0,
          maximumFutureSkewMs: 100
        },
        {
          name: "traces",
          ageMs: 4000,
          maximumAgeMs: 2000,
          futureSkewMs: 0,
          maximumFutureSkewMs: 100
        }
      ]
    });
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertion: "metrics freshness", status: "passed" }),
        expect.objectContaining({ assertion: "logs freshness", status: "failed", observed: 3000 }),
        expect.objectContaining({ assertion: "traces freshness", status: "failed", observed: 4000 })
      ])
    );
  });

  it("does not pass when required signal or saturation evidence is empty", () => {
    expect(assertionsFor("telemetry.freshness", { signals: [] })).toEqual([
      expect.objectContaining({ assertion: "required signals", status: "failed" })
    ]);
    expect(assertionsFor("metric.multi_threshold", { metrics: [] })).toEqual([
      expect.objectContaining({ assertion: "required metrics", status: "failed" })
    ]);
  });

  it("requires traffic and request samples for release health", () => {
    const noTraffic = assertionsFor("metric.threshold", {
      value: 0,
      threshold: 1,
      operator: "lte",
      sampleCount: 10,
      minimumSamples: 5,
      requestCount: 0,
      minimumRequests: 200
    });
    expect(noTraffic).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assertion: "minimum requests", status: "failed" })
      ])
    );
  });

  it("fails correlation, service graph, saturation, and stability independently", () => {
    expect(
      assertionsFor("telemetry.correlation", {
        sampledCount: 20,
        correlatedCount: 10,
        minimumCorrelatedPercent: 95
      }).some((result) => result.status === "failed")
    ).toBe(true);
    expect(
      assertionsFor("telemetry.service_graph", {
        callerPresent: true,
        observedDependencies: ["payments"],
        requiredDependencies: ["payments", "inventory"],
        unknownPeerPercent: 10,
        maximumUnknownPeerPercent: 5
      }).filter((result) => result.status === "failed")
    ).toHaveLength(2);
    expect(
      assertionsFor("metric.multi_threshold", {
        requestCount: 500,
        minimumRequests: 200,
        metrics: [{ name: "cpu", value: 0.95, operator: "lte", threshold: 0.85 }]
      }).some((result) => result.status === "failed")
    ).toBe(true);
    expect(
      assertionsFor("runtime.stability", {
        unexpectedRestarts: 1,
        crashLoops: 0,
        outOfMemoryTerminations: 0,
        unhealthyInstances: 0
      }).some((result) => result.status === "failed")
    ).toBe(true);
  });
});
