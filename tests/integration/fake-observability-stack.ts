import type { FetchLike } from "@observability-gate/providers";

export type FakeProviderScenario =
  | "healthy"
  | "empty"
  | "malformed"
  | "unauthorized"
  | "forbidden"
  | "rate-limited"
  | "bad-gateway"
  | "unavailable"
  | "gateway-timeout";

export class FakeObservabilityStack {
  private readonly counts = new Map<string, number>();
  private active = 0;
  private maximumActive = 0;

  public constructor(
    private scenario: FakeProviderScenario = "healthy",
    private readonly timestamp = "2026-10-06T00:00:00.000Z"
  ) {}

  public readonly fetch: FetchLike = async (input) => {
    const url = new URL(input);
    const key = `${url.hostname}${url.pathname}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    try {
      await Promise.resolve();
      const status = this.failureStatus();
      if (status !== undefined) {
        return Response.json({ message: this.scenario }, { status });
      }
      if (this.scenario === "malformed") {
        return new Response("{not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      return Response.json(this.payload(url));
    } finally {
      this.active -= 1;
    }
  };

  public select(scenario: FakeProviderScenario): void {
    this.scenario = scenario;
  }

  public requestCount(host: string, path: string): number {
    return this.counts.get(`${host}${path}`) ?? 0;
  }

  public maximumConcurrency(): number {
    return this.maximumActive;
  }

  private failureStatus(): number | undefined {
    return {
      unauthorized: 401,
      forbidden: 403,
      "rate-limited": 429,
      "bad-gateway": 502,
      unavailable: 503,
      "gateway-timeout": 504
    }[this.scenario];
  }

  private payload(url: URL): unknown {
    const epochSeconds = Date.parse(this.timestamp) / 1_000;
    if (url.pathname === "/api/v1/query") {
      return {
        status: "success",
        data: {
          resultType: "vector",
          result:
            this.scenario === "empty"
              ? []
              : [
                  {
                    metric: {
                      service_name: "checkout",
                      service_namespace: "commerce",
                      service_version: "release-candidate",
                      deployment_environment: "production"
                    },
                    value: [
                      epochSeconds,
                      url.searchParams.get("query") === "slo_status" ? "1" : "0.01"
                    ]
                  }
                ]
        }
      };
    }
    if (url.pathname === "/loki/api/v1/query_range") {
      return {
        status: "success",
        data: {
          resultType: "streams",
          result:
            this.scenario === "empty"
              ? []
              : [
                  {
                    stream: {
                      service: "checkout",
                      resource_service_name: "checkout",
                      resource_service_namespace: "commerce",
                      resource_service_version: "release-candidate",
                      resource_deployment_environment_name: "production"
                    },
                    values: [
                      [
                        String(BigInt(Date.parse(this.timestamp)) * 1_000_000n),
                        "checkout ready",
                        { trace_id: "trace-1", span_id: "span-1" }
                      ]
                    ]
                  }
                ]
        }
      };
    }
    if (url.pathname === "/api/search") {
      return {
        traces:
          this.scenario === "empty"
            ? []
            : [
                {
                  traceID: "trace-1",
                  rootServiceName: "checkout",
                  rootTraceName: "GET /checkout",
                  startTimeUnixNano: String(BigInt(Date.parse(this.timestamp)) * 1_000_000n),
                  durationMs: 25,
                  resource: {
                    "service.name": "checkout",
                    "service.namespace": "commerce",
                    "service.version": "release-candidate",
                    "deployment.environment.name": "production"
                  },
                  spans: []
                }
              ]
      };
    }
    if (url.pathname.startsWith("/api/dashboards/uid/")) {
      return {
        dashboard: {
          uid: "checkout",
          title: "checkout",
          panels: [1, 2, 3, 4].map((id) => ({
            id,
            title: ["Traffic", "Errors", "Latency", "Saturation"][id - 1],
            datasource: { type: "prometheus" }
          })),
          templating: {
            list: [
              { name: "service", type: "query" },
              { name: "environment", type: "query" }
            ]
          }
        },
        meta: { updated: this.timestamp }
      };
    }
    if (url.pathname === "/api/v1/provisioning/alert-rules") return [];
    if (url.pathname === "/api/v1/provisioning/policies") {
      return {
        routes: [
          {
            receiver: "oncall",
            object_matchers: [
              ["service", "=", "checkout"],
              ["environment", "=", "production"]
            ],
            mute_time_intervals: []
          }
        ]
      };
    }
    if (url.pathname === "/api/v1/provisioning/contact-points")
      return [{ uid: "oncall", name: "oncall", type: "webhook", settings: {} }];
    if (url.pathname.startsWith("/api/datasources/proxy/uid/"))
      return { status: "success", data: { resultType: "vector", result: [] } };
    if (url.pathname.includes("/resources/v1/slo/")) {
      return {
        uuid: "checkout",
        name: "checkout availability",
        description: "Checkout availability",
        objectives: [{ value: 0.999, window: "30d" }],
        labels: [
          { key: "service", value: "checkout" },
          { key: "environment", value: "production" }
        ],
        destinationDatasource: { uid: "prom" },
        query: { type: "freeform", freeform: { query: "up" } },
        readOnly: {
          creationTimestamp: Date.parse(this.timestamp) / 1000,
          status: { type: "created" }
        }
      };
    }
    return { status: "ok", release: "release-candidate" };
  }
}
