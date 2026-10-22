import { EvidenceStore } from "@observability-gate/core";
import { createBuiltInGateCatalog, type GateContext } from "@observability-gate/gates";
import { createPolicyProviderSession, type ProviderPolicy } from "@observability-gate/providers";
import { describe, expect, it } from "vitest";

const now = Date.parse("2026-10-22T10:00:00Z");
const sloPath = "/api/plugins/grafana-slo-app/resources/v1/slo/checkout";
const slo = {
  uuid: "checkout",
  name: "Checkout",
  description: "Availability",
  objectives: [{ value: 0.999, window: "28d" }],
  labels: [
    { key: "service", value: "checkout" },
    { key: "environment", value: "production" }
  ],
  destinationDatasource: { uid: "prom" },
  query: {
    type: "ratio",
    ratio: {
      successMetric: { prometheusMetric: 'http_requests_total{status!~"5.."}' },
      totalMetric: { prometheusMetric: "http_requests_total" }
    }
  }
};
const dashboard = {
  dashboard: {
    uid: "checkout",
    title: "Checkout Overview",
    panels: ["Traffic", "Errors", "Latency", "Saturation"].map((title, index) => ({
      id: index,
      title,
      type: "timeseries",
      datasource: { type: "prometheus", uid: "prom" }
    })),
    templating: { list: [{ name: "cluster", type: "query" }] }
  }
};
const rule = {
  uid: "errors",
  title: "Errors",
  condition: "A",
  noDataState: "NoData",
  execErrState: "Error",
  isPaused: false,
  for: "5m",
  labels: { service: "checkout", severity: "critical", owner: "sre" },
  annotations: { runbook_url: "https://runbooks.example/errors" },
  data: [{ refId: "A", datasourceUid: "prom", model: { expr: "up" } }]
};
function policy(): ProviderPolicy {
  return {
    identity: { canonical: { service_name: "checkout", environment: "production" } },
    release: {},
    observation: {},
    execution: {},
    targets: {},
    providers: {
      telemetry: {
        grafana: { endpoint: "https://grafana.example.test" },
        metrics: { endpoint: "https://metrics.example.test" }
      }
    },
    gates: {},
    reporting: {},
    security: {},
    limits: {}
  };
}
function metric(value: number) {
  return {
    status: "success",
    data: { resultType: "vector", result: [{ metric: {}, value: [now / 1000, String(value)] }] }
  };
}
async function acquire(
  type: string,
  assertions: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
  queryValues: Record<string, number> = {}
) {
  const paths: Record<string, unknown> = {
    [sloPath]: slo,
    "/api/dashboards/uid/checkout": dashboard,
    "/api/v1/provisioning/alert-rules": [rule],
    "/api/v1/provisioning/policies": {
      receiver: "default",
      routes: [
        {
          receiver: "pager",
          object_matchers: [["service", "=", "checkout"]],
          routes: [{ object_matchers: [["severity", "=", "critical"]] }]
        }
      ]
    },
    "/api/v1/provisioning/contact-points": [
      { uid: "pager", name: "pager", type: "webhook", settings: {} }
    ],
    ...overrides
  };
  const urls: URL[] = [];
  const session = createPolicyProviderSession({
    policy: policy(),
    workspaceRoot: process.cwd(),
    environment: {},
    clock: () => now,
    resolveHostname: async () => ["203.0.113.10"],
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.startsWith("/api/datasources/proxy/uid/")) return Response.json(metric(1));
      if (url.hostname === "metrics.example.test")
        return Response.json(metric(queryValues[url.searchParams.get("query") ?? ""] ?? 1));
      return Response.json(paths[url.pathname] ?? {}, {
        status: url.pathname in paths ? 200 : 404
      });
    }
  });
  const definition = {
    type,
    source: {
      provider: "grafana",
      uid: "checkout",
      labels: { service: "checkout" },
      match: { service: "checkout", severity: "critical" },
      queries: {
        status: "slo_status",
        remaining_percent: "slo_remaining",
        release_consumed_percent: "slo_release_consumed"
      }
    },
    assertions
  };
  const context: GateContext = {
    phase: "pre_deployment",
    targetId: "checkout",
    evidenceStore: new EvidenceStore(),
    signal: new AbortController().signal,
    clock: () => new Date(now),
    missingEvidenceBehavior: { blocking: "fail", advisory: "warn" },
    resolveEvidence: session.resolveEvidence
  };
  const gate = createBuiltInGateCatalog().require(type, "pre_deployment", definition);
  const raw = await gate.acquire(context);
  return { raw, assertions: raw[0]?.state === "valid" ? gate.evaluate(raw, context) : [], urls };
}
const dashboardAssertions = {
  exists: true,
  title_contains: "Checkout",
  minimum_panels: 4,
  required_panel_signals: ["traffic", "errors", "latency", "saturation"],
  required_template_variables: ["cluster"]
};
describe("public Grafana acquisition and readiness evaluation", () => {
  it("passes a vendor-shaped dashboard meeting every configured assertion", async () => {
    const result = await acquire("grafana.dashboard", dashboardAssertions);
    expect(result.raw[0]?.state).toBe("valid");
    expect(result.assertions.every((v) => v.status === "passed")).toBe(true);
  });
  it.each([
    { minimum_panels: 8 },
    { title_contains: "Payments" },
    { required_template_variables: ["namespace"] },
    { required_panel_signals: ["saturation"] }
  ])("blocks the configured dashboard violation %j", async (change) => {
    const overrides =
      "required_panel_signals" in change
        ? {
            "/api/dashboards/uid/checkout": {
              dashboard: {
                ...dashboard.dashboard,
                panels: dashboard.dashboard.panels.map((panel) => ({
                  ...panel,
                  title: "Unrelated"
                }))
              }
            }
          }
        : {};
    const result = await acquire(
      "grafana.dashboard",
      { ...dashboardAssertions, ...change },
      overrides
    );
    expect(result.raw[0]?.state).toBe("valid");
    expect(result.assertions.some((v) => v.status === "failed")).toBe(true);
  });
  it("uses provisioning configuration and enforces alert minimum and no-data policy", async () => {
    const assertions = {
      minimum_enabled_rules: 1,
      require_severity_label: true,
      require_owner_label: true,
      require_runbook_annotation: true,
      forbid_no_data_ok_on_critical_rules: true
    };
    const pass = await acquire("grafana.alert_rules", assertions);
    expect(pass.raw[0]?.state).toBe("valid");
    expect(pass.assertions.every((v) => v.status === "passed")).toBe(true);
    const count = await acquire("grafana.alert_rules", { ...assertions, minimum_enabled_rules: 5 });
    expect(count.assertions.some((v) => v.status === "failed")).toBe(true);
    const noData = await acquire("grafana.alert_rules", assertions, {
      "/api/v1/provisioning/alert-rules": [{ ...rule, noDataState: "OK" }]
    });
    expect(noData.assertions.some((v) => v.status === "failed")).toBe(true);
  });
  it.each(["severity", "owner", "runbook_url"])(
    "blocks missing required %s metadata",
    async (field) => {
      const altered = structuredClone(rule);
      if (field === "runbook_url") Reflect.deleteProperty(altered.annotations, field);
      else Reflect.deleteProperty(altered.labels, field);
      const result = await acquire(
        "grafana.alert_rules",
        {
          minimum_enabled_rules: 1,
          require_severity_label: true,
          require_owner_label: true,
          require_runbook_annotation: true
        },
        { "/api/v1/provisioning/alert-rules": [altered] }
      );
      expect(result.raw[0]?.state).toBe("valid");
      expect(result.assertions.some((v) => v.status === "failed")).toBe(true);
    }
  );
  it("validates actual SLO indicator queries against their Grafana datasource", async () => {
    const result = await acquire("grafana.slo_definition", {
      exists: true,
      objective_percent: { minimum: 99, maximum: 100 },
      window: { minimum: "7d" },
      indicator_query_is_valid: true,
      labels_match_identity: true
    });
    expect(result.raw[0]?.state).toBe("valid");
    expect(result.assertions.every((v) => v.status === "passed")).toBe(true);
    expect(
      result.urls.filter((url) => url.pathname.startsWith("/api/datasources/proxy/uid/prom/"))
    ).toHaveLength(2);
  });
  it.each([
    { objective_percent: { minimum: 99.99 } },
    { objective_percent: { maximum: 99 } },
    { window: { minimum: "29d" } }
  ])("blocks SLO definition policy violation %j", async (assertions) => {
    const result = await acquire("grafana.slo_definition", assertions);
    expect(result.raw[0]?.state).toBe("valid");
    expect(result.assertions.some((v) => v.status === "failed")).toBe(true);
  });
  it("blocks mismatched SLO identity", async () => {
    const result = await acquire(
      "grafana.slo_definition",
      { labels_match_identity: true },
      { [sloPath]: { ...slo, labels: [{ key: "service", value: "other" }] } }
    );
    expect(result.assertions.some((v) => v.status === "failed")).toBe(true);
  });
  it("resolves nested policy inheritance and configured contact points", async () => {
    const result = await acquire("grafana.notification_policy", {
      route_exists: true,
      receiver_is_configured: true,
      mute_timing_does_not_cover_deployment_window: true
    });
    expect(result.raw[0]?.state).toBe("valid");
    expect(result.assertions.every((v) => v.status === "passed")).toBe(true);
  });
  it.each([0, 1])("uses measured SLO status %s rather than provisioning status", async (status) => {
    const result = await acquire("grafana.slo_status", {}, {}, { slo_status: status });
    expect(result.raw[0]?.state).toBe("valid");
    expect(result.assertions.every((v) => v.status === "passed")).toBe(status === 1);
  });
  it.each([5, 80])(
    "uses measured error budget %s rather than invented API percentages",
    async (remaining) => {
      const result = await acquire(
        "grafana.error_budget",
        { minimum_remaining_percent: 25 },
        {},
        { slo_remaining: remaining }
      );
      expect(result.raw[0]?.state).toBe("valid");
      expect(result.assertions.every((v) => v.status === "passed")).toBe(remaining >= 25);
    }
  );
});
