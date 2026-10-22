import type { DashboardSignal, DashboardSnapshot } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function signalFor(value: unknown): DashboardSignal {
  if (!isRecord(value) || typeof value.type !== "string") {
    return "unknown";
  }
  const type = value.type.toLowerCase();
  if (type.includes("prometheus")) return "metrics";
  if (type.includes("loki")) return "logs";
  if (type.includes("tempo")) return "traces";
  return "unknown";
}

export function normalizeDashboard(
  payload: unknown,
  expectedTitle?: string
): DashboardSnapshot | undefined {
  if (!isRecord(payload) || !isRecord(payload.dashboard)) {
    return undefined;
  }
  const dashboard = payload.dashboard;
  if (
    typeof dashboard.uid !== "string" ||
    typeof dashboard.title !== "string" ||
    !Array.isArray(dashboard.panels)
  ) {
    return undefined;
  }
  const panels: DashboardSnapshot["panels"][number][] = [];
  const visit = (items: unknown[], depth: number): boolean => {
    if (depth > 32) return false;
    for (const value of items) {
      if (!isRecord(value) || typeof value.id !== "number" || typeof value.title !== "string")
        return false;
      if (value.type === "row") {
        if (
          value.panels !== undefined &&
          (!Array.isArray(value.panels) || !visit(value.panels, depth + 1))
        )
          return false;
        continue;
      }
      // Operational coverage is classified from explicit panel titles, not datasource type.
      const signals = (
        [
          ["traffic", /\b(?:traffic|request rate|throughput)\b/iu],
          ["errors", /\b(?:errors?|failures?)\b/iu],
          ["latency", /\b(?:latency|duration|response time)\b/iu],
          ["saturation", /\b(?:saturation|utilization)\b/iu]
        ] as const
      )
        .filter(([, pattern]) => pattern.test(value.title as string))
        .map(([signal]) => signal);
      panels.push(
        Object.freeze({
          id: value.id,
          title: value.title,
          signal: signalFor(value.datasource),
          signals: Object.freeze(signals)
        })
      );
    }
    return true;
  };
  if (!visit(dashboard.panels, 0)) return undefined;
  const templating = isRecord(dashboard.templating) ? dashboard.templating : {};
  const rawVariables = templating.list === undefined ? [] : templating.list;
  if (!Array.isArray(rawVariables)) {
    return undefined;
  }
  const variables = [];
  for (const value of rawVariables) {
    if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string") {
      return undefined;
    }
    variables.push(Object.freeze({ name: value.name, type: value.type }));
  }
  const meta = isRecord(payload.meta) ? payload.meta : {};
  const updatedAt = typeof meta.updated === "string" ? meta.updated : undefined;
  return Object.freeze({
    uid: dashboard.uid,
    title: dashboard.title,
    ...(expectedTitle === undefined
      ? {}
      : { titleMatches: dashboard.title.includes(expectedTitle) }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    panels: Object.freeze(panels),
    variables: Object.freeze(variables)
  });
}
