import {
  GateError,
  classifyFreshness,
  stableFingerprint,
  type Diagnostic,
  type Evidence,
  type EvidenceState
} from "@observability-gate/core";
import type { TransportRequest } from "../transport/guarded-fetch.js";
import { normalizeAlertRules, normalizeNotificationRoute } from "./alerts.js";
import { normalizeDashboard } from "./dashboard.js";
import { normalizeSlo } from "./slo.js";
import type {
  AlertRuleSnapshot,
  AlertRulesRequest,
  DashboardRequest,
  DashboardSnapshot,
  GrafanaProvider,
  GrafanaRequestBase,
  GrafanaTransport,
  NotificationRouteRequest,
  NotificationRouteSnapshot,
  SloRequest,
  SloSnapshot
} from "./types.js";

export interface GrafanaClientOptions {
  readonly endpoint: string;
  readonly provider: string;
  readonly transport: GrafanaTransport;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly headers?: HeadersInit;
  readonly clock?: () => number;
}

interface HttpStatusError extends GateError {
  readonly httpStatus: number;
}

function hasHttpStatus(error: GateError): error is HttpStatusError {
  return "httpStatus" in error && typeof error.httpStatus === "number";
}

export class GrafanaClient implements GrafanaProvider {
  private readonly endpoint: URL;
  private readonly options: GrafanaClientOptions;
  private readonly clock: () => number;

  public constructor(options: GrafanaClientOptions) {
    this.endpoint = new URL(
      options.endpoint.endsWith("/") ? options.endpoint : `${options.endpoint}/`
    );
    this.options = options;
    this.clock = options.clock ?? Date.now;
  }

  public async getDashboard(request: DashboardRequest): Promise<Evidence<DashboardSnapshot>> {
    return this.load(
      request,
      `api/dashboards/uid/${encodeURIComponent(request.uid)}`,
      "grafana.dashboard",
      "dashboard.read",
      (payload) => normalizeDashboard(payload, request.expectedTitle),
      (value) => value.updatedAt
    );
  }

  public async getAlertRules(
    request: AlertRulesRequest
  ): Promise<Evidence<readonly AlertRuleSnapshot[]>> {
    return this.load(
      request,
      "api/v1/provisioning/alert-rules",
      "grafana.alert-rules",
      "alerting.rules.read",
      (payload) => normalizeAlertRules(payload, request.selector),
      (value) =>
        value.reduce<string | undefined>(
          (latest, rule) =>
            latest === undefined || rule.evaluatedAt > latest ? rule.evaluatedAt : latest,
          undefined
        ),
      true
    );
  }

  public async getNotificationRoute(
    request: NotificationRouteRequest
  ): Promise<Evidence<NotificationRouteSnapshot>> {
    return this.load(
      request,
      "api/v1/provisioning/policies",
      "grafana.notification-route",
      "alerting.policies.read",
      (payload) => normalizeNotificationRoute(payload, request)
    );
  }

  public async getSlo(request: SloRequest): Promise<Evidence<SloSnapshot>> {
    return this.load(
      request,
      `api/plugins/grafana-slo-app/resources/v1/slo/${encodeURIComponent(request.uid)}`,
      "grafana.slo",
      "slo.read",
      normalizeSlo,
      (value) => value.evaluatedAt,
      true
    );
  }

  private async load<T>(
    request: GrafanaRequestBase,
    path: string,
    kind: string,
    capability: string,
    normalize: (payload: unknown) => T | undefined,
    observedAtFor?: (value: T) => string | undefined,
    freshnessSensitive = false
  ): Promise<Evidence<T>> {
    const acquiredAt = new Date(this.clock()).toISOString();
    const base = {
      id: stableFingerprint({
        provider: this.options.provider,
        capability,
        target: request.target,
        path,
        acquiredAt
      }),
      kind,
      source: Object.freeze({ provider: this.options.provider, capability }),
      target: request.target,
      acquiredAt
    };
    let payload: unknown;
    try {
      payload = (await this.options.transport.request(this.transportRequest(path, request))).data;
    } catch (error) {
      const gateError =
        error instanceof GateError
          ? error
          : new GateError({
              code: "PROVIDER_UNAVAILABLE",
              safeMessage: "Grafana request failed",
              retryable: true,
              cause: error
            });
      if (gateError.code === "CANCELLED") throw gateError;
      const state: EvidenceState =
        hasHttpStatus(gateError) && gateError.httpStatus === 404
          ? "missing"
          : gateError.code === "PROVIDER_PROTOCOL"
            ? "invalid"
            : "unavailable";
      return Object.freeze({
        ...base,
        state,
        diagnostics: Object.freeze([gateError.toDiagnostic()])
      });
    }

    const value = normalize(payload);
    if (value === undefined) {
      const diagnostics: readonly Diagnostic[] = Object.freeze([
        {
          code: "EVIDENCE_INVALID",
          message: "Grafana returned malformed evidence",
          retryable: false
        }
      ]);
      return Object.freeze({ ...base, state: "invalid", diagnostics });
    }
    const observedAt = observedAtFor?.(value);
    const state =
      freshnessSensitive && observedAt !== undefined
        ? classifyFreshness({
            observedAt,
            acquiredAt,
            maximumAgeMs: request.maximumAgeMs,
            maximumFutureSkewMs: request.maximumFutureSkewMs,
            sampleCount: 1,
            minimumSamples: 1
          })
        : "valid";
    return Object.freeze({
      ...base,
      state,
      ...(observedAt === undefined ? {} : { observedAt }),
      value,
      diagnostics: Object.freeze([])
    });
  }

  private transportRequest(path: string, request: GrafanaRequestBase): TransportRequest {
    return {
      url: new URL(path, this.endpoint),
      kind: "provider",
      headers: this.options.headers ?? {},
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maximumResponseBytes: this.options.maximumResponseBytes ?? 2 * 1024 * 1024,
      retry: {
        attempts: 3,
        initialBackoffMs: 200,
        maximumBackoffMs: 2_000,
        retryStatuses: [429, 502, 503, 504]
      },
      signal: request.signal ?? new AbortController().signal,
      ...(request.deadlineAtMs === undefined ? {} : { deadlineAtMs: request.deadlineAtMs })
    };
  }
}
