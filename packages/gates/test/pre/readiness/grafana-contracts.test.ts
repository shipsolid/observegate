import { describe, expect, it } from "vitest";
import { EvidenceStore, type Evidence } from "@observability-gate/core";
import { GateCatalog, registerReadinessGates, type GateContext } from "../../../src/index.js";
const context: GateContext = {
  phase: "pre_deployment",
  targetId: "test",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date(),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};
function evaluate(
  type: string,
  assertions: Record<string, unknown>,
  value: Record<string, unknown>
) {
  const evidence: Evidence<unknown> = {
    id: "test",
    kind: type,
    state: "valid",
    source: { provider: "grafana", capability: "read" },
    target: "test",
    acquiredAt: new Date().toISOString(),
    value,
    diagnostics: []
  };
  return registerReadinessGates(new GateCatalog())
    .require(type, "pre_deployment", { assertions })
    .evaluate([evidence], context);
}
const dashboard = {
  uid: "checkout",
  title: "Checkout Overview",
  panels: ["traffic", "errors", "latency", "saturation"].map((signal) => ({
    signal,
    signals: [signal]
  })),
  variables: [{ name: "cluster" }]
};
describe("configured Grafana readiness assertions", () => {
  it.each([
    [{ minimum_panels: 8 }, dashboard],
    [{ title_contains: "Payments" }, dashboard],
    [{ required_template_variables: ["environment"] }, dashboard],
    [
      { required_panel_signals: ["saturation"] },
      { ...dashboard, panels: [{ signals: ["traffic"] }] }
    ]
  ])("fails an unmet dashboard assertion %j", (assertions, value) => {
    expect(
      evaluate("grafana.dashboard", assertions, value).some((v) => v.status === "failed")
    ).toBe(true);
  });
  it("uses configured dashboard minimum, substring, variables, and signals", () => {
    expect(
      evaluate(
        "grafana.dashboard",
        {
          minimum_panels: 4,
          title_contains: "Checkout",
          required_template_variables: ["cluster"],
          required_panel_signals: ["traffic", "errors", "latency", "saturation"]
        },
        dashboard
      ).every((v) => v.status === "passed")
    ).toBe(true);
  });
  it("enforces configured alert count and critical no-data behavior", () => {
    const rules = [
      {
        enabled: true,
        severity: "critical",
        noDataState: "OK",
        owner: "sre",
        runbookUrl: "https://runbooks.example/test"
      },
      { enabled: true, severity: "warning", noDataState: "NoData" }
    ];
    expect(
      evaluate("grafana.alert_rules", { minimum_enabled_rules: 5 }, { rules }).some(
        (v) => v.status === "failed"
      )
    ).toBe(true);
    expect(
      evaluate(
        "grafana.alert_rules",
        { minimum_enabled_rules: 2, forbid_no_data_ok_on_critical_rules: true },
        { rules }
      ).some((v) => v.status === "failed")
    ).toBe(true);
    expect(
      evaluate(
        "grafana.alert_rules",
        {
          minimum_enabled_rules: 1,
          require_severity_label: false,
          require_owner_label: false,
          require_runbook_annotation: false
        },
        { rules: [{ enabled: true }] }
      ).every((v) => v.status === "passed")
    ).toBe(true);
  });
  it.each([
    { objective_percent: { minimum: 99.99, maximum: 100 } },
    { objective_percent: { minimum: 90, maximum: 95 } },
    { window: { minimum: "31d" } },
    { indicator_query_is_valid: true },
    { labels_match_identity: true }
  ])("enforces SLO assertion %j", (assertions) => {
    expect(
      evaluate("grafana.slo_definition", assertions, {
        uid: "slo",
        objective: 99.9,
        window: "30d",
        indicatorQueryIsValid: false,
        labelsMatchIdentity: false
      }).some((v) => v.status === "failed")
    ).toBe(true);
  });
  it("compares duration units and permits configured lower objectives", () => {
    expect(
      evaluate(
        "grafana.slo_definition",
        {
          objective_percent: { minimum: 90, maximum: 95 },
          window: { minimum: "168h" },
          labels_match_identity: false
        },
        { uid: "slo", objective: 94, window: "7d" }
      ).every((v) => v.status === "passed")
    ).toBe(true);
  });
  it("requires explicit unmuted evidence", () => {
    expect(
      evaluate(
        "grafana.notification_policy",
        { mute_timing_does_not_cover_deployment_window: true },
        { receiver: "pager" }
      ).some((v) => v.status === "failed")
    ).toBe(true);
  });
});
