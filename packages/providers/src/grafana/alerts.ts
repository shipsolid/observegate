import type {
  AlertRuleSnapshot,
  ActiveAlertSnapshot,
  NotificationRouteRequest,
  NotificationRouteSnapshot
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringLabels(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    return undefined;
  }
  return Object.freeze({ ...(value as Record<string, string>) });
}

export function normalizeAlertRules(
  payload: unknown,
  selector: Readonly<Record<string, string>>
): readonly AlertRuleSnapshot[] | undefined {
  if (!Array.isArray(payload)) {
    return undefined;
  }
  const rules: AlertRuleSnapshot[] = [];
  for (const value of payload) {
    if (!isRecord(value)) return undefined;
    const labels = stringLabels(value.labels);
    if (
      labels === undefined ||
      typeof value.uid !== "string" ||
      typeof value.title !== "string" ||
      typeof value.isPaused !== "boolean" ||
      !["normal", "pending", "firing", "no_data", "error"].includes(String(value.state)) ||
      !["ok", "error", "no_data"].includes(String(value.health)) ||
      typeof value.lastEvaluation !== "string" ||
      !Number.isFinite(Date.parse(value.lastEvaluation))
    ) {
      return undefined;
    }
    if (Object.entries(selector).some(([key, expected]) => labels[key] !== expected)) {
      continue;
    }
    rules.push(
      Object.freeze({
        uid: value.uid,
        title: value.title,
        enabled: !value.isPaused,
        labels,
        ...(labels.severity === undefined ? {} : { severity: labels.severity }),
        ...(labels.owner === undefined ? {} : { owner: labels.owner }),
        ...(labels.runbook_url === undefined ? {} : { runbookUrl: labels.runbook_url }),
        state: value.state as AlertRuleSnapshot["state"],
        health: value.health as AlertRuleSnapshot["health"],
        evaluatedAt: new Date(value.lastEvaluation).toISOString()
      })
    );
  }
  return Object.freeze(rules);
}

export function normalizeNotificationRoute(
  payload: unknown,
  request: NotificationRouteRequest
): NotificationRouteSnapshot | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.routes)) {
    return undefined;
  }
  const route = payload.routes.find((value) => {
    if (!isRecord(value) || !Array.isArray(value.object_matchers)) return false;
    const objectMatchers = value.object_matchers;
    return Object.entries(request.selector).every(([key, expected]) =>
      objectMatchers.some(
        (matcher) =>
          Array.isArray(matcher) &&
          matcher[0] === key &&
          matcher[1] === "=" &&
          matcher[2] === expected
      )
    );
  });
  if (!isRecord(route) || typeof route.receiver !== "string") {
    return undefined;
  }
  const muteTimeIntervals = route.mute_time_intervals ?? [];
  if (
    !Array.isArray(muteTimeIntervals) ||
    muteTimeIntervals.some((item) => typeof item !== "string")
  ) {
    return undefined;
  }
  const deploymentStart = Date.parse(request.deploymentStart);
  const deploymentEnd = Date.parse(request.deploymentEnd);
  if (!Number.isFinite(deploymentStart) || !Number.isFinite(deploymentEnd)) {
    return undefined;
  }
  const muteWindows = Array.isArray(payload.mute_windows) ? payload.mute_windows : [];
  const mutedDuringDeployment = muteWindows.some((window) => {
    if (!isRecord(window) || typeof window.name !== "string") return false;
    return (
      muteTimeIntervals.includes(window.name) &&
      Date.parse(String(window.start)) <= deploymentStart &&
      Date.parse(String(window.end)) >= deploymentEnd
    );
  });
  return Object.freeze({
    receiver: route.receiver,
    matchers: Object.freeze({ ...request.selector }),
    muteTimeIntervals: Object.freeze([...(muteTimeIntervals as string[])]),
    mutedDuringDeployment
  });
}

export function normalizeActiveAlerts(
  payload: unknown,
  selector: Readonly<Record<string, string>>,
  maximumStartAtMs: number
): readonly ActiveAlertSnapshot[] | undefined {
  if (
    !isRecord(payload) ||
    payload.status !== "success" ||
    !isRecord(payload.data) ||
    !Array.isArray(payload.data.alerts) ||
    payload.data.alerts.length > 10_000
  )
    return undefined;
  const alerts: ActiveAlertSnapshot[] = [];
  for (const value of payload.data.alerts) {
    if (!isRecord(value)) return undefined;
    const labels = stringLabels(value.labels);
    const start = value.activeAt ?? value.startsAt;
    if (
      labels === undefined ||
      typeof labels.alertname !== "string" ||
      labels.alertname.length === 0 ||
      (value.state !== "pending" && value.state !== "firing") ||
      typeof start !== "string" ||
      !Number.isFinite(Date.parse(start)) ||
      Date.parse(start) > maximumStartAtMs
    )
      return undefined;
    if (Object.entries(selector).some(([key, expected]) => labels[key] !== expected)) continue;
    alerts.push(
      Object.freeze({
        name: labels.alertname,
        labels,
        state: value.state,
        startsAt: new Date(start).toISOString()
      })
    );
  }
  return Object.freeze(alerts);
}
