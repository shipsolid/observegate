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
    const labels = stringLabels(value.labels ?? {});
    const annotations = stringLabels(value.annotations ?? {});
    if (
      labels === undefined ||
      annotations === undefined ||
      typeof value.uid !== "string" ||
      typeof value.title !== "string" ||
      typeof value.isPaused !== "boolean"
    )
      return undefined;
    // Recording rules share the provisioning endpoint but cannot page an operator.
    if (value.record !== undefined && value.record !== null) continue;
    if (!["OK", "NoData", "Alerting", "KeepLast"].includes(String(value.noDataState)))
      return undefined;
    if (Object.entries(selector).some(([key, expected]) => labels[key] !== expected)) continue;
    rules.push(
      Object.freeze({
        uid: value.uid,
        title: value.title,
        enabled: !value.isPaused,
        labels,
        ...(labels.severity === undefined ? {} : { severity: labels.severity }),
        ...(labels.owner === undefined ? {} : { owner: labels.owner }),
        ...(annotations.runbook_url === undefined ? {} : { runbookUrl: annotations.runbook_url }),
        noDataState: value.noDataState as AlertRuleSnapshot["noDataState"]
      })
    );
  }
  return Object.freeze(rules);
}

export function normalizeNotificationRoute(
  payload: unknown,
  request: NotificationRouteRequest
): NotificationRouteSnapshot | undefined {
  if (!isRecord(payload)) return undefined;
  if (
    !Number.isFinite(Date.parse(request.deploymentStart)) ||
    !Number.isFinite(Date.parse(request.deploymentEnd)) ||
    Date.parse(request.deploymentEnd) < Date.parse(request.deploymentStart)
  )
    return undefined;
  const selected: { receiver: string; mute: string[]; active: string[] }[] = [];
  let unsupported: string | undefined;
  const matches = (route: Record<string, unknown>): boolean | undefined => {
    if (route.matchers !== undefined || route.match_re !== undefined || route.match !== undefined) {
      unsupported = "Unsupported notification matcher syntax; cannot establish effective routing";
      return undefined;
    }
    if (route.object_matchers === undefined) return true;
    if (!Array.isArray(route.object_matchers)) return undefined;
    let result = true;
    for (const m of route.object_matchers) {
      if (!Array.isArray(m) || m.length !== 3 || m.some((v) => typeof v !== "string"))
        return undefined;
      const [key, operator, value] = m as [string, string, string];
      if (operator !== "=" && operator !== "!=") {
        unsupported =
          "Regex notification matchers are unsupported; cannot establish effective routing";
        return undefined;
      }
      // The selector is a partial label set: absent labels are unknown, not empty.
      if (!Object.hasOwn(request.selector, key)) {
        unsupported = "Notification routing depends on labels absent from source.match";
        return undefined;
      }
      result &&=
        operator === "=" ? request.selector[key] === value : request.selector[key] !== value;
    }
    return result;
  };
  const names = (value: unknown): string[] | undefined =>
    value === undefined
      ? []
      : Array.isArray(value) && value.every((v) => typeof v === "string")
        ? value
        : undefined;
  const visit = (
    route: Record<string, unknown>,
    inheritedReceiver: string,
    inheritedMute: string[],
    inheritedActive: string[],
    depth: number
  ): boolean => {
    if (depth > 32) return false;
    const receiver =
      typeof route.receiver === "string" && route.receiver.length > 0
        ? route.receiver
        : inheritedReceiver;
    const ownMute = names(route.mute_time_intervals);
    const ownActive = names(route.active_time_intervals);
    // Ancestor schedules also require evaluation before this path can prove unmuted.
    const mute = ownMute === undefined ? undefined : [...inheritedMute, ...ownMute];
    const active = ownActive === undefined ? undefined : [...inheritedActive, ...ownActive];
    if (
      mute === undefined ||
      active === undefined ||
      (route.continue !== undefined && typeof route.continue !== "boolean")
    )
      return false;
    const children = route.routes ?? [];
    if (!Array.isArray(children)) return false;
    let matched = false;
    for (const child of children) {
      if (!isRecord(child)) return false;
      const match = matches(child);
      if (match === undefined) return false;
      if (!match) continue;
      matched = true;
      if (!visit(child, receiver, mute, active, depth + 1)) return false;
      if (child.continue !== true) break;
    }
    if (!matched) selected.push({ receiver, mute, active });
    return true;
  };
  const complete = visit(payload, "", [], [], 0);
  if (!complete && unsupported === undefined) return undefined;
  const receivers = [...new Set(selected.map((v) => v.receiver))];
  const muteTimeIntervals = [...new Set(selected.flatMap((v) => v.mute))];
  const hasTimings = selected.some((v) => v.mute.length > 0 || v.active.length > 0);
  if (hasTimings && request.requireUnmuted !== false)
    unsupported =
      "Referenced mute or active time intervals require recurring schedule evaluation, which is unsupported";
  return Object.freeze({
    receiver: receivers[0] ?? "",
    receivers: Object.freeze(receivers),
    matchers: Object.freeze({ ...request.selector }),
    muteTimeIntervals: Object.freeze(muteTimeIntervals),
    ...(!hasTimings && unsupported === undefined ? { mutedDuringDeployment: false } : {}),
    ...(unsupported === undefined ? {} : { unsupportedReason: unsupported })
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
