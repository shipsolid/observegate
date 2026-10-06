import type { SloSnapshot } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeSlo(payload: unknown): SloSnapshot | undefined {
  if (
    !isRecord(payload) ||
    typeof payload.uid !== "string" ||
    typeof payload.name !== "string" ||
    !finite(payload.objective) ||
    typeof payload.window !== "string" ||
    !isRecord(payload.labels) ||
    Object.values(payload.labels).some((value) => typeof value !== "string") ||
    !["met", "unmet", "no_data"].includes(String(payload.status)) ||
    typeof payload.evaluatedAt !== "string" ||
    !Number.isFinite(Date.parse(payload.evaluatedAt)) ||
    !isRecord(payload.errorBudget) ||
    !finite(payload.errorBudget.remainingPercent) ||
    !finite(payload.errorBudget.consumedPercent) ||
    !Array.isArray(payload.burnRates)
  ) {
    return undefined;
  }
  const burnRates = [];
  for (const value of payload.burnRates) {
    if (
      !isRecord(value) ||
      typeof value.shortWindow !== "string" ||
      typeof value.longWindow !== "string" ||
      !finite(value.value)
    ) {
      return undefined;
    }
    burnRates.push(
      Object.freeze({
        shortWindow: value.shortWindow,
        longWindow: value.longWindow,
        value: value.value
      })
    );
  }
  return Object.freeze({
    uid: payload.uid,
    name: payload.name,
    objective: payload.objective,
    window: payload.window,
    labels: Object.freeze({ ...(payload.labels as Record<string, string>) }),
    status: payload.status as SloSnapshot["status"],
    evaluatedAt: new Date(payload.evaluatedAt).toISOString(),
    remainingBudgetPercent: payload.errorBudget.remainingPercent,
    consumedBudgetPercent: payload.errorBudget.consumedPercent,
    burnRates: Object.freeze(burnRates)
  });
}
