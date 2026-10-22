import { EvidenceStore, type Evidence } from "@observability-gate/core";
import { GateCatalog, registerReadinessGates, type GateContext } from "../../../src/index.js";
import { describe, expect, it } from "vitest";
const context: GateContext = {
  phase: "pre_deployment",
  targetId: "test",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date(),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};
function evaluate(assertions: Record<string, unknown>, query: Record<string, unknown>) {
  const raw: Evidence<unknown> = {
    id: "test",
    kind: "telemetry.query_validation",
    state: "valid",
    target: "test",
    acquiredAt: new Date().toISOString(),
    source: { provider: "test", capability: "read" },
    diagnostics: [],
    value: { queries: [{ valid: true, production: false, groupBy: [], rangeMs: 60000, ...query }] }
  };
  return registerReadinessGates(new GateCatalog())
    .require("telemetry.query_validation", "pre_deployment", { assertions })
    .evaluate([raw], context);
}
describe("query validation assertion policy", () => {
  it("allows disabling scalar requirements", () => {
    expect(
      evaluate(
        { require_scalar_for_threshold_gates: false },
        { threshold: true, shape: "vector" }
      ).every((a) => a.status === "passed")
    ).toBe(true);
  });
  it("uses configured forbidden grouping labels", () => {
    expect(
      evaluate({ reject_high_cardinality_grouping: ["customer"] }, { groupBy: ["customer"] }).some(
        (a) => a.status === "failed"
      )
    ).toBe(true);
  });
  it("allows an explicitly empty grouping prohibition", () => {
    expect(
      evaluate({ reject_high_cardinality_grouping: [] }, { groupBy: ["user_id"] }).every(
        (a) => a.status === "passed"
      )
    ).toBe(true);
  });
  it("enforces log bounds when requested", () => {
    expect(
      evaluate({ reject_unbounded_log_queries: true }, { signal: "logs", bounded: false }).some(
        (a) => a.status === "failed"
      )
    ).toBe(true);
  });
  it("enforces the maximum query range", () => {
    expect(
      evaluate({ maximum_query_range: "1h" }, { rangeMs: 7200000 }).some(
        (a) => a.status === "failed"
      )
    ).toBe(true);
  });
});
