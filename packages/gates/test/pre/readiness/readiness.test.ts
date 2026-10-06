import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EvidenceStore, type Evidence } from "@observability-gate/core";
import { GateCatalog, registerReadinessGates, type GateContext } from "../../../src/index.js";

const referenceTypes = [
  ["readiness.policy", "policy.self_check"],
  ["readiness.identity", "identity.contract"],
  ["readiness.owner", "asset.metadata"],
  ["readiness.runbook", "asset.url"],
  ["readiness.dashboard", "grafana.dashboard"],
  ["readiness.alert-rules", "grafana.alert_rules"],
  ["readiness.alert-routing", "grafana.notification_policy"],
  ["readiness.slo", "grafana.slo_definition"],
  ["readiness.gate-queries", "telemetry.query_validation"],
  ["readiness.instrumentation-configuration", "artifact.instrumentation_configuration"],
  ["readiness.static-instrumentation-analysis", "evidence.sarif"],
  ["readiness.telemetry-contract-test", "evidence.otlp_contract"],
  ["readiness.telemetry-routing", "telemetry.pipeline_configuration"],
  ["readiness.synthetic-plan", "synthetic.plan"],
  ["readiness.post-gate-coverage", "policy.coverage"]
] as const;

const context: GateContext = {
  phase: "pre_deployment",
  targetId: "prod-checkout",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date("2026-10-06T08:00:00.000Z"),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};

async function fixture(kind: "readiness-pass" | "readiness-fail") {
  return JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(`../../../../../fixtures/repositories/${kind}/evidence.json`, import.meta.url)
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
    target: "prod-checkout",
    acquiredAt: "2026-10-06T08:00:00.000Z",
    value,
    diagnostics: []
  };
}

describe("readiness gate catalogue", () => {
  it("resolves every reference readiness gate for pre-deployment", () => {
    const catalog = registerReadinessGates(new GateCatalog());
    for (const [id, type] of referenceTypes) {
      expect(catalog.require(type, "pre_deployment", { id })).toMatchObject({
        metadata: { type, supportedPhases: ["pre_deployment"] }
      });
    }
  });

  it("passes the complete readiness repository fixture", async () => {
    const catalog = registerReadinessGates(new GateCatalog());
    const values = await fixture("readiness-pass");
    for (const [, type] of referenceTypes) {
      const resolved = catalog.require(type, "pre_deployment", {});
      const assertions = resolved.evaluate([evidence(type, values[type] ?? {})], context);
      expect(assertions.length, type).toBeGreaterThan(0);
      expect(
        assertions.every((assertion) => assertion.status === "passed"),
        type
      ).toBe(true);
    }
  });

  it("reports every focused identity, query, and coverage failure", async () => {
    const catalog = registerReadinessGates(new GateCatalog());
    const values = await fixture("readiness-fail");
    for (const type of ["identity.contract", "telemetry.query_validation", "policy.coverage"]) {
      const assertions = catalog
        .require(type, "pre_deployment", {})
        .evaluate([evidence(type, values[type] ?? {})], context);
      expect(
        assertions.some((assertion) => assertion.status === "failed"),
        type
      ).toBe(true);
    }
    const coverage = catalog
      .require("policy.coverage", "pre_deployment", {})
      .evaluate([evidence("policy.coverage", values["policy.coverage"] ?? {})], context);
    expect(coverage[0]?.message).toContain("workload_identity");
    expect(coverage[0]?.message).toContain("active_alerts");
  });
});
