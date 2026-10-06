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
  const panels = [];
  for (const value of dashboard.panels) {
    if (!isRecord(value) || typeof value.id !== "number" || typeof value.title !== "string") {
      return undefined;
    }
    panels.push(
      Object.freeze({
        id: value.id,
        title: value.title,
        signal: signalFor(value.datasource)
      })
    );
  }
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
    ...(expectedTitle === undefined ? {} : { titleMatches: dashboard.title === expectedTitle }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    panels: Object.freeze(panels),
    variables: Object.freeze(variables)
  });
}
