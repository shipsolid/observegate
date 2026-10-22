import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EvidenceStore, GateError, type Evidence } from "@observability-gate/core";
import {
  GateCatalog,
  parseChangeWindowConfiguration,
  registerRiskGates,
  type GateContext
} from "../../../src/index.js";

const referenceTypes = [
  ["risk.telemetry-backends", "providers.health"],
  ["risk.current-health", "metric.threshold"],
  ["risk.current-error-rate", "metric.threshold"],
  ["risk.slo-status", "grafana.slo_status"],
  ["risk.error-budget", "grafana.error_budget"],
  ["risk.burn-rate", "grafana.burn_rate"],
  ["risk.active-alerts", "grafana.alert_state"],
  ["risk.active-incidents", "evidence.incident_state"],
  ["risk.dependencies", "dependency.health"],
  ["risk.collector-health", "telemetry.collector_health"],
  ["risk.capacity-headroom", "runtime.capacity"],
  ["risk.change-freeze", "policy.change_window"],
  ["risk.concurrent-deployment", "deployment.concurrency"],
  ["risk.cardinality-change", "telemetry.cardinality_estimate"],
  ["risk.telemetry-volume", "telemetry.volume_estimate"]
] as const;

const context: GateContext = {
  phase: "pre_deployment",
  targetId: "prod-checkout",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date("2026-10-06T08:00:00.000Z"),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};

async function healthyFixture() {
  return JSON.parse(
    await readFile(
      fileURLToPath(
        new URL("../../../../../fixtures/repositories/risk-pass/evidence.json", import.meta.url)
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
  const catalog = registerRiskGates(new GateCatalog());
  const definition =
    type === "telemetry.cardinality_estimate"
      ? { assertions: { new_metric_series: { less_than_or_equal: 1000 } } }
      : type === "telemetry.volume_estimate"
        ? { assertions: { estimated_growth_percent: { metrics: { less_than_or_equal: 20 } } } }
        : {};
  return catalog
    .require(type, "pre_deployment", definition)
    .evaluate([evidence(type, value)], context);
}

describe("pre-deployment risk gate catalogue", () => {
  it("resolves every reference risk gate", () => {
    const catalog = registerRiskGates(new GateCatalog());
    for (const [id, type] of referenceTypes) {
      const definition =
        type.startsWith("telemetry.") && type.endsWith("_estimate")
          ? { id, enforcement: "advisory" }
          : { id };
      expect(catalog.require(type, "pre_deployment", definition).metadata.type).toBe(type);
    }
  });

  it("passes a complete healthy risk fixture", async () => {
    const values = await healthyFixture();
    for (const [, type] of referenceTypes) {
      const results = assertionsFor(type, values[type] ?? {});
      expect(results.length, type).toBeGreaterThan(0);
      expect(
        results.every((result) => result.status === "passed"),
        type
      ).toBe(true);
    }
  });

  it.each([
    ["grafana.alert_state", { fresh: true, alerts: [{ state: "firing" }] }],
    [
      "grafana.burn_rate",
      { fresh: true, pairs: [{ shortValue: 15, longValue: 3, maximum: 14.4 }] }
    ],
    ["grafana.error_budget", { fresh: true, remainingPercent: 5, minimumRemainingPercent: 25 }],
    ["dependency.health", { dependencies: [{ required: true, healthy: false }] }],
    [
      "telemetry.collector_health",
      {
        exportFailures: 0,
        refusedRecords: 0,
        maximumQueueUtilizationPercent: 95,
        allowedQueueUtilizationPercent: 80
      }
    ],
    ["policy.change_window", { freezeActive: true }],
    [
      "deployment.concurrency",
      { currentDeploymentId: "deploy-42", deployments: [{ id: "deploy-41", active: true }] }
    ]
  ])("fails %s for unsafe evidence", (type, value) => {
    expect(assertionsFor(type, value).some((result) => result.status === "failed")).toBe(true);
  });

  it("requires fresh Grafana evidence", () => {
    for (const [type, value] of [
      ["grafana.slo_status", { status: "met", fresh: false }],
      ["grafana.error_budget", { remainingPercent: 50, minimumRemainingPercent: 25, fresh: false }],
      ["grafana.burn_rate", { pairs: [{ shortValue: 1, longValue: 1, maximum: 2 }], fresh: false }],
      ["grafana.alert_state", { alerts: [], fresh: false }]
    ] as const) {
      expect(
        assertionsFor(type, value).some((result) => result.status === "failed"),
        type
      ).toBe(true);
    }
  });

  it("accepts an approved complete freeze exception without exposing sensitive values", () => {
    const results = assertionsFor("policy.change_window", {
      freezeActive: true,
      exceptionApproved: true,
      exceptionId: "CHG-42",
      exceptionReason: "sensitive operational context",
      exceptionApprover: "security@example.test"
    });
    expect(results.every((result) => result.status === "passed")).toBe(true);
    expect(JSON.stringify(results)).not.toContain("sensitive operational context");
    expect(JSON.stringify(results)).not.toContain("security@example.test");
  });

  it("requires an explicit IANA timezone in change-window configuration", () => {
    expect(parseChangeWindowConfiguration({ timezone: "Asia/Kolkata", freezes: [] })).toEqual({
      timezone: "Asia/Kolkata",
      freezes: []
    });
    expect(() => parseChangeWindowConfiguration({ freezes: [] })).toThrowError(GateError);
    expect(() => parseChangeWindowConfiguration({ timezone: "IST", freezes: [] })).toThrowError(
      /IANA timezone/
    );
  });

  it("rejects blocking telemetry budgets including unsupported overrides", () => {
    const catalog = registerRiskGates(new GateCatalog());
    expect(() =>
      catalog.require("telemetry.cardinality_estimate", "pre_deployment", {
        enforcement: "blocking"
      })
    ).toThrowError(GateError);
    expect(() =>
      catalog.require("telemetry.volume_estimate", "pre_deployment", {
        enforcement: "blocking",
        allowBlockingBudget: true
      })
    ).toThrow();
  });
});
