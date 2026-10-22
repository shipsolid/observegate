import type { Evidence } from "@observability-gate/core";
import type { MetricsTransport } from "../metrics/types.js";

export interface GrafanaRequestBase {
  readonly target: string;
  readonly maximumAgeMs: number;
  readonly maximumFutureSkewMs: number;
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
}

export type DashboardSignal = "metrics" | "logs" | "traces" | "unknown";

export interface DashboardSnapshot {
  readonly uid: string;
  readonly title: string;
  readonly titleMatches?: boolean;
  readonly updatedAt?: string;
  readonly panels: readonly {
    readonly id: number;
    readonly title: string;
    readonly signal: DashboardSignal;
    readonly signals: readonly ("traffic" | "errors" | "latency" | "saturation")[];
  }[];
  readonly variables: readonly { readonly name: string; readonly type: string }[];
}

export interface DashboardRequest extends GrafanaRequestBase {
  readonly uid: string;
  readonly expectedTitle?: string;
}

export interface AlertRuleSnapshot {
  readonly uid: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly labels: Readonly<Record<string, string>>;
  readonly severity?: string;
  readonly owner?: string;
  readonly runbookUrl?: string;
  readonly noDataState: "OK" | "NoData" | "Alerting" | "KeepLast";
}

export interface ActiveAlertSnapshot {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly state: "pending" | "firing";
  readonly startsAt: string;
}

export interface AlertRulesRequest extends GrafanaRequestBase {
  readonly selector: Readonly<Record<string, string>>;
}

export interface NotificationRouteSnapshot {
  readonly receiver: string;
  readonly matchers: Readonly<Record<string, string>>;
  readonly muteTimeIntervals: readonly string[];
  readonly mutedDuringDeployment?: boolean;
  readonly receivers: readonly string[];
  readonly receiverConfigured?: boolean;
  readonly unsupportedReason?: string;
}

export interface NotificationRouteRequest extends GrafanaRequestBase {
  readonly selector: Readonly<Record<string, string>>;
  readonly deploymentStart: string;
  readonly deploymentEnd: string;
  readonly requireUnmuted?: boolean;
  readonly verifyReceiver?: boolean;
}

export interface SloSnapshot {
  readonly uid: string;
  readonly name: string;
  readonly objective: number;
  readonly window: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly datasourceUid?: string;
  readonly indicatorQueryIsValid?: boolean;
}

export interface SloRequest extends GrafanaRequestBase {
  readonly uid: string;
  readonly validateIndicatorQuery?: boolean;
}

export interface GrafanaProvider {
  getDashboard(request: DashboardRequest): Promise<Evidence<DashboardSnapshot>>;
  getActiveAlerts?(request: AlertRulesRequest): Promise<Evidence<readonly ActiveAlertSnapshot[]>>;
  getAlertRules(request: AlertRulesRequest): Promise<Evidence<readonly AlertRuleSnapshot[]>>;
  getNotificationRoute(
    request: NotificationRouteRequest
  ): Promise<Evidence<NotificationRouteSnapshot>>;
  getSlo(request: SloRequest): Promise<Evidence<SloSnapshot>>;
}

export type GrafanaTransport = MetricsTransport;
