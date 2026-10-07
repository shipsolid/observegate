import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { URL } from "node:url";

const releaseId = process.env.RELEASE_ID ?? "local-release";
const environment = process.env.ENVIRONMENT ?? "test";
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
let requests = 0;
let errors = 0;
let totalDurationSeconds = 0;

function identity() {
  return {
    "service.name": "checkout",
    "service.namespace": "commerce",
    "service.version": releaseId,
    "deployment.environment.name": environment
  };
}

async function emitOtlp(traceId, spanId, status, durationMs) {
  if (otlpEndpoint === undefined) return;
  const observed = new Date().toISOString();
  const payloads = [
    [
      "v1/metrics",
      {
        resource: identity(),
        metrics: [{ name: "http.server.request.duration", value: durationMs / 1000, observed }]
      }
    ],
    [
      "v1/logs",
      {
        resource: identity(),
        logs: [
          {
            severity: status >= 500 ? "ERROR" : "INFO",
            body: "checkout request",
            traceId,
            spanId,
            observed
          }
        ]
      }
    ],
    [
      "v1/traces",
      {
        resource: identity(),
        traces: [
          {
            traceId,
            spans: [
              {
                spanId,
                name: "GET /checkout",
                kind: "SERVER",
                status: status >= 500 ? "ERROR" : "OK",
                attributes: { "http.route": "/checkout" },
                durationMs
              }
            ],
            observed
          }
        ]
      }
    ]
  ];
  await Promise.allSettled(
    payloads.map(([path, body]) =>
      globalThis.fetch(`${otlpEndpoint}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
    )
  );
}

function metrics() {
  return [
    "# TYPE http_server_request_duration_seconds_count counter",
    `http_server_request_duration_seconds_count{service_name="checkout",service_namespace="commerce",service_version="${releaseId}",deployment_environment="${environment}"} ${requests}`,
    "# TYPE http_server_request_duration_seconds_sum counter",
    `http_server_request_duration_seconds_sum{service_name="checkout",service_namespace="commerce",service_version="${releaseId}",deployment_environment="${environment}"} ${totalDurationSeconds}`,
    "# TYPE http_server_requests_errors_total counter",
    `http_server_requests_errors_total{service_name="checkout",service_namespace="commerce",service_version="${releaseId}",deployment_environment="${environment}"} ${errors}`,
    "# TYPE observegate_build_info gauge",
    `observegate_build_info{service_name="checkout",service_namespace="commerce",service_version="${releaseId}",deployment_environment="${environment}"} 1`,
    ""
  ].join("\n");
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json", "x-release-id": releaseId });
    response.end(JSON.stringify({ status: "ok", release: releaseId, environment }));
    return;
  }
  if (url.pathname === "/metrics") {
    response.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
    response.end(metrics());
    return;
  }
  if (url.pathname !== "/checkout") {
    response.writeHead(404).end();
    return;
  }

  const started = performance.now();
  const delayMs = Number(url.searchParams.get("delay_ms") ?? 0);
  if (delayMs > 0)
    await new Promise((resolve) => globalThis.setTimeout(resolve, Math.min(delayMs, 5_000)));
  const status = url.searchParams.get("error") === "true" ? 503 : 200;
  const durationMs = performance.now() - started;
  const traceId = randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  requests += 1;
  totalDurationSeconds += durationMs / 1000;
  if (status >= 500) errors += 1;
  const log = {
    timestamp: new Date().toISOString(),
    severity: status >= 500 ? "ERROR" : "INFO",
    message: "checkout request",
    trace_id: traceId,
    span_id: spanId,
    status,
    duration_ms: durationMs,
    resource: identity()
  };
  process.stdout.write(`${JSON.stringify(log)}\n`);
  await emitOtlp(traceId, spanId, status, durationMs);
  response.writeHead(status, {
    "content-type": "application/json",
    "x-release-id": releaseId,
    traceparent: `00-${traceId}-${spanId}-01`
  });
  response.end(
    JSON.stringify({ status: status === 200 ? "accepted" : "failed", release: releaseId })
  );
});

server.listen(8080, "0.0.0.0");
