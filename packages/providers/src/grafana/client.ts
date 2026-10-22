import {
  GateError,
  classifyFreshness,
  stableFingerprint,
  type Diagnostic,
  type Evidence,
  type EvidenceState
} from "@observability-gate/core";
import type { TransportRequest } from "../transport/guarded-fetch.js";
import {
  normalizeActiveAlerts,
  normalizeAlertRules,
  normalizeNotificationRoute
} from "./alerts.js";
import { normalizeDashboard } from "./dashboard.js";
import { indicatorQueries, normalizeSlo } from "./slo.js";
import type {
  AlertRuleSnapshot,
  ActiveAlertSnapshot,
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
      (payload) => {
        const value = normalizeDashboard(payload, request.expectedTitle);
        return value?.uid === request.uid ? value : undefined;
      },
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
      () => new Date(this.clock()).toISOString()
    );
  }

  public async getActiveAlerts(
    request: AlertRulesRequest
  ): Promise<Evidence<readonly ActiveAlertSnapshot[]>> {
    return this.load(
      request,
      "api/prometheus/grafana/api/v1/alerts",
      "grafana.active-alerts",
      "alerting.state.read",
      (payload) =>
        normalizeActiveAlerts(
          payload,
          request.selector,
          this.clock() + request.maximumFutureSkewMs
        ),
      () => new Date(this.clock()).toISOString(),
      true
    );
  }

  public async getNotificationRoute(
    request: NotificationRouteRequest
  ): Promise<Evidence<NotificationRouteSnapshot>> {
    const route = await this.load(
      request,
      "api/v1/provisioning/policies",
      "grafana.notification-route",
      "alerting.policies.read",
      (payload) => normalizeNotificationRoute(payload, request)
    );
    if (route.state !== "valid" || route.value === undefined) return route;
    if (route.value.unsupportedReason !== undefined)
      return this.insufficient(route, route.value.unsupportedReason);
    if (request.verifyReceiver === false) return route;
    const contacts = await this.load(
      request,
      "api/v1/provisioning/contact-points",
      "grafana.contact-points",
      "alerting.receivers.read",
      (payload) => {
        if (
          !Array.isArray(payload) ||
          payload.some(
            (v) =>
              v === null ||
              typeof v !== "object" ||
              typeof v.name !== "string" ||
              v.name.length === 0 ||
              typeof v.type !== "string" ||
              v.type.length === 0 ||
              v.settings === null ||
              typeof v.settings !== "object"
          )
        )
          return undefined;
        return payload.map((v) => String(v.name));
      }
    );
    if (contacts.state !== "valid" || contacts.value === undefined)
      return Object.freeze({ ...route, state: contacts.state, diagnostics: contacts.diagnostics });
    return Object.freeze({
      ...route,
      value: Object.freeze({
        ...route.value,
        receiverConfigured:
          route.value.receivers.length > 0 &&
          route.value.receivers.every((receiver) => contacts.value?.includes(receiver))
      })
    });
  }

  public async getSlo(request: SloRequest): Promise<Evidence<SloSnapshot>> {
    const raw = await this.load(
      request,
      `api/plugins/grafana-slo-app/resources/v1/slo/${encodeURIComponent(request.uid)}`,
      "grafana.slo",
      "slo.read",
      normalizeSlo,
      undefined,
      false,
      "Grafana SLO evidence must use uuid, labels as key/value pairs, and exactly one fractional objective with its window"
    );
    if (raw.state !== "valid" || raw.value === undefined) return raw;
    if (raw.value.uid !== request.uid)
      return Object.freeze({
        ...raw,
        state: "invalid",
        diagnostics: Object.freeze([
          {
            code: "EVIDENCE_INVALID",
            message: "Grafana SLO UUID does not match the requested identity",
            retryable: false
          }
        ])
      });
    if (request.validateIndicatorQuery !== true) return raw;
    const queries = indicatorQueries(raw.value);
    if (queries === undefined || raw.value.datasourceUid === undefined)
      return this.insufficient(
        raw,
        "SLO indicator validation supports ratio/freeform Prometheus queries with an explicit datasource UID"
      );
    for (const query of queries) {
      const parameters = new URLSearchParams({ query });
      const result = await this.load(
        request,
        `api/datasources/proxy/uid/${encodeURIComponent(raw.value.datasourceUid)}/api/v1/query?${parameters.toString()}`,
        "grafana.slo-indicator",
        "datasources.query.read",
        (payload) => {
          if (
            payload === null ||
            typeof payload !== "object" ||
            !("status" in payload) ||
            payload.status !== "success" ||
            !("data" in payload) ||
            payload.data === null ||
            typeof payload.data !== "object" ||
            !("resultType" in payload.data) ||
            !["vector", "scalar", "matrix"].includes(String(payload.data.resultType)) ||
            !("result" in payload.data) ||
            !Array.isArray(payload.data.result)
          )
            return undefined;
          return true;
        }
      );
      if (result.state !== "valid")
        return Object.freeze({ ...raw, state: result.state, diagnostics: result.diagnostics });
    }
    return Object.freeze({
      ...raw,
      value: Object.freeze({ ...raw.value, indicatorQueryIsValid: true })
    });
  }

  private insufficient<T>(raw: Evidence<T>, message: string): Evidence<T> {
    return Object.freeze({
      ...raw,
      state: "insufficient",
      diagnostics: Object.freeze([{ code: "EVIDENCE_INSUFFICIENT", message, retryable: false }])
    });
  }

  private async load<T>(
    request: GrafanaRequestBase,
    path: string,
    kind: string,
    capability: string,
    normalize: (payload: unknown) => T | undefined,
    observedAtFor?: (value: T) => string | undefined,
    freshnessSensitive = false,
    invalidMessage = "Grafana returned malformed evidence"
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
          message: invalidMessage,
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
