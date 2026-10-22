import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GateError } from "@observability-gate/core";
import { GrafanaClient, type TransportRequest, type TransportResponse } from "../../src/index.js";

const now = Date.parse("2026-10-06T08:00:30.000Z");

async function fixture(name: string): Promise<unknown> {
  const path = fileURLToPath(
    new URL(`../../../../fixtures/providers/grafana/${name}.json`, import.meta.url)
  );
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function client(responses: Readonly<Record<string, unknown | Error>>) {
  const request = vi.fn(async (input: TransportRequest): Promise<TransportResponse> => {
    const pathname = new URL(String(input.url)).pathname;
    const response = responses[pathname];
    if (response instanceof Error) {
      throw response;
    }
    if (response === undefined) {
      throw new Error(`No fixture for ${pathname}`);
    }
    return { status: 200, data: response, attempts: 1, headers: new Headers() };
  });
  return {
    grafana: new GrafanaClient({
      endpoint: "https://grafana.example.com/",
      provider: "grafana-primary",
      transport: { request },
      clock: () => now
    }),
    request
  };
}

const common = {
  target: "prod-checkout",
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 5_000
};

function httpError(status: number): GateError & { httpStatus: number } {
  return Object.assign(
    new GateError({
      code:
        status === 401
          ? "AUTHENTICATION"
          : status === 403
            ? "AUTHORIZATION"
            : status === 429 || status >= 500
              ? "PROVIDER_UNAVAILABLE"
              : "PROVIDER_PROTOCOL",
      safeMessage: `Provider returned HTTP ${status}`,
      retryable: status === 429 || status >= 500
    }),
    { httpStatus: status }
  );
}

describe("GrafanaClient dashboards", () => {
  it("normalizes panels, signal classes, variables, and title comparison", async () => {
    const { grafana } = client({
      "/api/dashboards/uid/checkout-overview": await fixture("dashboard")
    });
    const evidence = await grafana.getDashboard({
      ...common,
      uid: "checkout-overview",
      expectedTitle: "Checkout Overview"
    });

    expect(evidence).toMatchObject({
      state: "valid",
      value: {
        uid: "checkout-overview",
        title: "Checkout Overview",
        titleMatches: true,
        panels: [
          { title: "Request rate", signal: "metrics" },
          { title: "Errors", signal: "logs" },
          { title: "Latency traces", signal: "traces" }
        ],
        variables: [
          { name: "service", type: "query" },
          { name: "environment", type: "custom" }
        ]
      }
    });

    const wrong = await grafana.getDashboard({
      ...common,
      uid: "checkout-overview",
      expectedTitle: "Wrong title"
    });
    expect(wrong).toMatchObject({ state: "valid", value: { titleMatches: false } });
  });

  it("maps missing, permission, transient, and malformed dashboard states", async () => {
    for (const [status, expected] of [
      [404, "missing"],
      [401, "unavailable"],
      [403, "unavailable"],
      [429, "unavailable"],
      [503, "unavailable"]
    ] as const) {
      const { grafana } = client({ "/api/dashboards/uid/unknown": httpError(status) });
      await expect(grafana.getDashboard({ ...common, uid: "unknown" })).resolves.toMatchObject({
        state: expected
      });
    }
    const { grafana } = client({ "/api/dashboards/uid/broken": { dashboard: { uid: 3 } } });
    await expect(grafana.getDashboard({ ...common, uid: "broken" })).resolves.toMatchObject({
      state: "invalid"
    });
  });
});

describe("GrafanaClient alerting", () => {
  it("normalizes enabled provisioning metadata independently of evaluation freshness", async () => {
    const { grafana } = client({ "/api/v1/provisioning/alert-rules": await fixture("alerts") });
    expect(
      await grafana.getAlertRules({
        ...common,
        selector: { service: "checkout", environment: "production" }
      })
    ).toMatchObject({
      state: "valid",
      value: [
        {
          uid: "checkout-errors",
          enabled: true,
          severity: "critical",
          owner: "payments-sre",
          runbookUrl: "https://runbooks.example.com/checkout-errors",
          noDataState: "NoData"
        },
        { uid: "checkout-latency", noDataState: "NoData" }
      ]
    });
  });

  it("returns insufficient for recurring mute schedules", async () => {
    const { grafana } = client({ "/api/v1/provisioning/policies": await fixture("policy") });
    const evidence = await grafana.getNotificationRoute({
      ...common,
      selector: { severity: "critical" },
      deploymentStart: "2026-10-06T08:00:00.000Z",
      deploymentEnd: "2026-10-06T08:05:00.000Z"
    });
    expect(evidence).toMatchObject({
      state: "insufficient",
      diagnostics: [{ message: expect.stringContaining("mute") }]
    });
  });
});

describe("GrafanaClient SLO", () => {
  it("normalizes the vendor definition objective and label schema", async () => {
    const { grafana } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout-availability": await fixture("slo")
    });
    expect(await grafana.getSlo({ ...common, uid: "checkout-availability" })).toMatchObject({
      state: "valid",
      value: {
        uid: "checkout-availability",
        objective: 99.9,
        window: "30d",
        labels: { service: "checkout", environment: "production" }
      }
    });
  });
});

describe("GrafanaClient active alerts", () => {
  const activePath = "/api/prometheus/grafana/api/v1/alerts";
  it("reads actual active alert state and start time with exact service labels", async () => {
    const controller = new AbortController();
    const { grafana, request } = client({
      [activePath]: {
        status: "success",
        data: {
          alerts: [
            {
              labels: { alertname: "CheckoutErrors", service: "checkout", severity: "critical" },
              state: "firing",
              activeAt: "2026-10-06T07:59:00Z",
              value: "1"
            },
            {
              labels: { alertname: "OtherErrors", service: "other" },
              state: "firing",
              activeAt: "2026-10-06T07:59:00Z"
            },
            {
              labels: { alertname: "CheckoutLatency", service: "checkout" },
              state: "pending",
              startsAt: "2026-10-06T08:00:00Z"
            }
          ]
        }
      }
    });
    await expect(
      grafana.getActiveAlerts({
        ...common,
        selector: { service: "checkout" },
        signal: controller.signal,
        deadlineAtMs: now + 1000
      })
    ).resolves.toMatchObject({
      state: "valid",
      source: { capability: "alerting.state.read" },
      value: [
        {
          name: "CheckoutErrors",
          labels: { service: "checkout", severity: "critical" },
          state: "firing",
          startsAt: "2026-10-06T07:59:00.000Z"
        },
        { name: "CheckoutLatency", state: "pending", startsAt: "2026-10-06T08:00:00.000Z" }
      ]
    });
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      signal: controller.signal,
      deadlineAtMs: now + 1000,
      maximumResponseBytes: 2097152
    });
  });
  it("accepts an empty active-alert set as a fresh read", async () => {
    const { grafana } = client({ [activePath]: { status: "success", data: { alerts: [] } } });
    await expect(grafana.getActiveAlerts({ ...common, selector: {} })).resolves.toMatchObject({
      state: "valid",
      value: [],
      observedAt: new Date(now).toISOString()
    });
  });
  it.each([
    { status: "error", data: { alerts: [] } },
    { status: "success", data: { alerts: [{ labels: { alertname: "Bad" }, state: "firing" }] } },
    {
      status: "success",
      data: {
        alerts: [
          { labels: { alertname: "Bad" }, state: "normal", activeAt: "2026-10-06T08:00:00Z" }
        ]
      }
    },
    {
      status: "success",
      data: { alerts: [{ labels: { alertname: "Bad" }, state: "firing", activeAt: "bad-time" }] }
    },
    {
      status: "success",
      data: {
        alerts: [
          { labels: { alertname: "Future" }, state: "firing", activeAt: "2027-10-06T08:00:00Z" }
        ]
      }
    }
  ])("rejects malformed/unknown active state without inventing start times %s", async (payload) => {
    const { grafana } = client({ [activePath]: payload });
    await expect(grafana.getActiveAlerts({ ...common, selector: {} })).resolves.toMatchObject({
      state: "invalid"
    });
  });
  it("preserves cancellation as cancellation", async () => {
    const error = new GateError({ code: "CANCELLED", safeMessage: "Cancelled", retryable: false });
    const { grafana } = client({ [activePath]: error });
    await expect(grafana.getActiveAlerts({ ...common, selector: {} })).rejects.toMatchObject({
      code: "CANCELLED"
    });
  });
});

describe("vendor-shaped Grafana readiness contracts", () => {
  it("accepts provisioned configuration without evaluation-state fields", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/alert-rules": [
        {
          uid: "errors",
          title: "Errors",
          isPaused: false,
          condition: "A",
          noDataState: "OK",
          labels: { service: "checkout", severity: "critical" },
          annotations: { runbook_url: "https://runbooks.example/errors" },
          updated: "2020-01-01T00:00:00Z"
        }
      ]
    });
    const raw = await grafana.getAlertRules({ ...common, selector: { service: "checkout" } });
    expect(raw).toMatchObject({
      state: "valid",
      value: [{ noDataState: "OK", runbookUrl: "https://runbooks.example/errors" }]
    });
    expect(raw.value?.[0]).not.toHaveProperty("state");
    expect(raw.value?.[0]).not.toHaveProperty("evaluatedAt");
  });
  it("uses title substring and flattens row panels without counting the row", async () => {
    const { grafana } = client({
      "/api/dashboards/uid/d": {
        dashboard: {
          uid: "d",
          title: "Checkout Overview",
          panels: [
            {
              id: 1,
              title: "RED",
              type: "row",
              panels: [
                {
                  id: 2,
                  title: "Traffic request rate",
                  targets: [{ expr: "rate(http_requests_total[5m])" }]
                }
              ]
            }
          ]
        }
      }
    });
    expect(
      await grafana.getDashboard({ ...common, uid: "d", expectedTitle: "Checkout" })
    ).toMatchObject({
      state: "valid",
      value: { titleMatches: true, panels: [{ id: 2, signals: ["traffic"] }] }
    });
  });
  it("resolves inherited nested receivers and verifies the contact point", async () => {
    const { grafana } = client({
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
        { uid: "p", name: "pager", type: "webhook", settings: {} }
      ]
    });
    expect(
      await grafana.getNotificationRoute({
        ...common,
        selector: { service: "checkout", severity: "critical" },
        deploymentStart: "2026-10-06T08:00:00Z",
        deploymentEnd: "2026-10-06T08:05:00Z"
      })
    ).toMatchObject({
      state: "valid",
      value: { receiver: "pager", receiverConfigured: true, mutedDuringDeployment: false }
    });
  });
  it("does not invent unmuted evidence for named recurring mute schedules", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/policies": {
        receiver: "default",
        routes: [
          {
            receiver: "pager",
            object_matchers: [["severity", "=", "critical"]],
            mute_time_intervals: ["night"]
          }
        ]
      }
    });
    expect(
      await grafana.getNotificationRoute({
        ...common,
        selector: { severity: "critical" },
        deploymentStart: "2026-10-06T08:00:00Z",
        deploymentEnd: "2026-10-06T08:05:00Z"
      })
    ).toMatchObject({
      state: "insufficient",
      diagnostics: [{ message: expect.stringContaining("mute") }]
    });
  });
  it("normalizes the actual SLO definition without inventing health or budget", async () => {
    const { grafana } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout": {
        uuid: "checkout",
        name: "Checkout",
        description: "Availability",
        objectives: [{ value: 0.999, window: "28d" }],
        labels: [{ key: "service", value: "checkout" }],
        query: {
          type: "ratio",
          ratio: {
            successMetric: { prometheusMetric: 'requests_total{status="200"}' },
            totalMetric: { prometheusMetric: "requests_total" }
          }
        },
        destinationDatasource: { uid: "prom" },
        readOnly: { status: { type: "created" }, creationTimestamp: 1730000000 }
      }
    });
    const raw = await grafana.getSlo({ ...common, uid: "checkout" });
    expect(raw).toMatchObject({
      state: "valid",
      value: { uid: "checkout", objective: 99.9, window: "28d", labels: { service: "checkout" } }
    });
    expect(raw.value).not.toHaveProperty("status");
    expect(raw.value).not.toHaveProperty("remainingBudgetPercent");
  });
});

describe("conservative Grafana evidence boundaries", () => {
  const routeRequest = {
    ...common,
    selector: { service: "checkout", severity: "critical" },
    deploymentStart: "2026-10-06T08:00:00Z",
    deploymentEnd: "2026-10-06T08:05:00Z"
  };
  const contacts = [
    { name: "default", type: "webhook", settings: {} },
    { name: "pager", type: "webhook", settings: {} }
  ];
  it("uses the root default receiver when no child matches", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/policies": {
        receiver: "default",
        routes: [{ receiver: "pager", object_matchers: [["service", "=", "other"]] }]
      },
      "/api/v1/provisioning/contact-points": contacts
    });
    expect(await grafana.getNotificationRoute(routeRequest)).toMatchObject({
      state: "valid",
      value: {
        receiver: "default",
        receivers: ["default"],
        receiverConfigured: true,
        mutedDuringDeployment: false
      }
    });
  });
  it("checks every receiver selected by continue instead of only the first", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/policies": {
        receiver: "default",
        routes: [
          { receiver: "pager", object_matchers: [["service", "=", "checkout"]], continue: true },
          { receiver: "missing", object_matchers: [["severity", "=", "critical"]] }
        ]
      },
      "/api/v1/provisioning/contact-points": contacts
    });
    expect(await grafana.getNotificationRoute(routeRequest)).toMatchObject({
      state: "valid",
      value: { receiver: "pager", receivers: ["pager", "missing"], receiverConfigured: false }
    });
  });
  it.each([
    { receiver: "pager", object_matchers: [["service", "=~", "check.*"]] },
    { receiver: "pager", object_matchers: [["cluster", "=", "prod"]] },
    {
      receiver: "pager",
      object_matchers: [["service", "=", "checkout"]],
      active_time_intervals: ["office"]
    }
  ])("returns insufficient for unsupported routing or timing %j", async (route) => {
    const { grafana } = client({
      "/api/v1/provisioning/policies": { receiver: "default", routes: [route] }
    });
    expect(await grafana.getNotificationRoute(routeRequest)).toMatchObject({
      state: "insufficient",
      diagnostics: [{ code: "EVIDENCE_INSUFFICIENT" }]
    });
  });
  it("does not claim receiver configuration when its acquisition is denied", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/policies": { receiver: "pager" },
      "/api/v1/provisioning/contact-points": httpError(403)
    });
    expect(await grafana.getNotificationRoute(routeRequest)).toMatchObject({
      state: "unavailable"
    });
  });
  it("can check routing without making unsupported timing or contact claims", async () => {
    const { grafana, request } = client({
      "/api/v1/provisioning/policies": { receiver: "pager", mute_time_intervals: ["office"] }
    });
    const raw = await grafana.getNotificationRoute({
      ...routeRequest,
      requireUnmuted: false,
      verifyReceiver: false
    });
    expect(raw).toMatchObject({ state: "valid", value: { receiver: "pager" } });
    expect(raw.value).not.toHaveProperty("mutedDuringDeployment");
    expect(raw.value).not.toHaveProperty("receiverConfigured");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("validates a freeform SLO against the explicitly selected datasource", async () => {
    const payload = {
      ...((await fixture("slo")) as Record<string, unknown>),
      query: {
        type: "freeform",
        freeform: { sourceDatasourceUid: "source-prom", query: "sum(up)" }
      }
    };
    const { grafana, request } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout-availability": payload,
      "/api/datasources/proxy/uid/source-prom/api/v1/query": {
        status: "success",
        data: { resultType: "vector", result: [] }
      }
    });
    expect(
      await grafana.getSlo({
        ...common,
        uid: "checkout-availability",
        validateIndicatorQuery: true
      })
    ).toMatchObject({ state: "valid", value: { indicatorQueryIsValid: true } });
    expect(new URL(String(request.mock.calls[1]?.[0].url)).searchParams.get("query")).toBe(
      "sum(up)"
    );
  });
  it.each([
    httpError(403),
    { status: "error", error: "bad_data" },
    { status: "success", data: { resultType: "vector" } }
  ])("does not synthesize indicator validity after failed validation %j", async (response) => {
    const { grafana } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout-availability": await fixture("slo"),
      "/api/datasources/proxy/uid/prom/api/v1/query": response
    });
    const raw = await grafana.getSlo({
      ...common,
      uid: "checkout-availability",
      validateIndicatorQuery: true
    });
    expect(raw.state).not.toBe("valid");
    expect(raw.value).not.toHaveProperty("indicatorQueryIsValid");
  });
  it("rejects multiple SLO objectives instead of silently selecting the first", async () => {
    const payload = {
      ...((await fixture("slo")) as object),
      objectives: [
        { value: 0.99, window: "7d" },
        { value: 0.999, window: "28d" }
      ]
    };
    const { grafana } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout-availability": payload
    });
    expect(await grafana.getSlo({ ...common, uid: "checkout-availability" })).toMatchObject({
      state: "invalid"
    });
  });
  it("does not count recording rules as paging rules", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/alert-rules": [
        {
          uid: "record",
          title: "Recorded metric",
          isPaused: false,
          labels: { service: "checkout" },
          record: { metric: "http:rate5m", from: "A" }
        }
      ]
    });
    expect(
      await grafana.getAlertRules({ ...common, selector: { service: "checkout" } })
    ).toMatchObject({ state: "valid", value: [] });
  });
});
