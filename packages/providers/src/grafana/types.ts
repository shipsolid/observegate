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
  readonly state: "normal" | "pending" | "firing" | "no_data" | "error";
  readonly health: "ok" | "error" | "no_data";
  readonly evaluatedAt: string;
}

export interface AlertRulesRequest extends GrafanaRequestBase {
  readonly selector: Readonly<Record<string, string>>;
}

export interface NotificationRouteSnapshot {
  readonly receiver: string;
  readonly matchers: Readonly<Record<string, string>>;
  readonly muteTimeIntervals: readonly string[];
  readonly mutedDuringDeployment: boolean;
}

export interface NotificationRouteRequest extends GrafanaRequestBase {
  readonly selector: Readonly<Record<string, string>>;
  readonly deploymentStart: string;
  readonly deploymentEnd: string;
}

export interface SloSnapshot {
  readonly uid: string;
  readonly name: string;
  readonly objective: number;
  readonly window: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly status: "met" | "unmet" | "no_data";
  readonly evaluatedAt: string;
  readonly remainingBudgetPercent: number;
  readonly consumedBudgetPercent: number;
  readonly burnRates: readonly {
    readonly shortWindow: string;
    readonly longWindow: string;
    readonly value: number;
  }[];
}

export interface SloRequest extends GrafanaRequestBase {
  readonly uid: string;
}

export interface GrafanaProvider {
  getDashboard(request: DashboardRequest): Promise<Evidence<DashboardSnapshot>>;
  getAlertRules(request: AlertRulesRequest): Promise<Evidence<readonly AlertRuleSnapshot[]>>;
  getNotificationRoute(
    request: NotificationRouteRequest
  ): Promise<Evidence<NotificationRouteSnapshot>>;
  getSlo(request: SloRequest): Promise<Evidence<SloSnapshot>>;
}

export type GrafanaTransport = MetricsTransport;
