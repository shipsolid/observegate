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
  it("normalizes enabled rule metadata and firing, pending, error, and stale states", async () => {
    const { grafana } = client({
      "/api/v1/provisioning/alert-rules": await fixture("alerts")
    });
    const evidence = await grafana.getAlertRules({
      ...common,
      selector: { service: "checkout", environment: "production" }
    });

    expect(evidence).toMatchObject({
      state: "valid",
      value: [
        {
          uid: "checkout-errors",
          enabled: true,
          severity: "critical",
          owner: "payments-sre",
          runbookUrl: "https://runbooks.example.com/checkout-errors",
          state: "firing",
          health: "error"
        },
        { uid: "checkout-latency", state: "pending" }
      ]
    });

    const stalePayload = [
      {
        uid: "old",
        title: "Old",
        isPaused: false,
        labels: { service: "checkout" },
        state: "normal",
        health: "ok",
        lastEvaluation: "2026-10-06T07:00:00.000Z"
      }
    ];
    const stale = client({ "/api/v1/provisioning/alert-rules": stalePayload }).grafana;
    await expect(
      stale.getAlertRules({ ...common, selector: { service: "checkout" } })
    ).resolves.toMatchObject({ state: "stale" });
  });

  it("normalizes critical receiver routing and deployment-window mute coverage", async () => {
    const { grafana } = client({ "/api/v1/provisioning/policies": await fixture("policy") });
    const evidence = await grafana.getNotificationRoute({
      ...common,
      selector: { severity: "critical" },
      deploymentStart: "2026-10-06T08:00:00.000Z",
      deploymentEnd: "2026-10-06T08:05:00.000Z"
    });
    expect(evidence).toMatchObject({
      state: "valid",
      value: {
        receiver: "critical-pager",
        muteTimeIntervals: ["deployment-freeze"],
        mutedDuringDeployment: true
      }
    });
  });
});

describe("GrafanaClient SLO", () => {
  it("normalizes definition, status, budgets, labels, and paired burn windows", async () => {
    const { grafana } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout-availability": await fixture("slo")
    });
    const evidence = await grafana.getSlo({ ...common, uid: "checkout-availability" });
    expect(evidence).toMatchObject({
      state: "valid",
      value: {
        uid: "checkout-availability",
        objective: 99.9,
        window: "30d",
        labels: { service: "checkout", environment: "production" },
        status: "met",
        remainingBudgetPercent: 72.5,
        consumedBudgetPercent: 27.5,
        burnRates: [
          { shortWindow: "5m", longWindow: "1h", value: 0.8 },
          { shortWindow: "30m", longWindow: "6h", value: 0.4 }
        ]
      }
    });
  });

  it.each(["unmet", "no_data"] as const)("preserves valid %s SLO state", async (status) => {
    const payload = { ...((await fixture("slo")) as object), status };
    const { grafana } = client({
      "/api/plugins/grafana-slo-app/resources/v1/slo/checkout-availability": payload
    });
    await expect(
      grafana.getSlo({ ...common, uid: "checkout-availability" })
    ).resolves.toMatchObject({ state: "valid", value: { status } });
  });
});
