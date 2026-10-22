import type { SloSnapshot } from "./types.js";
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function normalizeSlo(payload: unknown): SloSnapshot | undefined {
  if (
    !isRecord(payload) ||
    typeof payload.uuid !== "string" ||
    typeof payload.name !== "string" ||
    !Array.isArray(payload.objectives) ||
    payload.objectives.length !== 1 ||
    !isRecord(payload.query)
  )
    return undefined;
  const objective: unknown = payload.objectives[0];
  if (
    !isRecord(objective) ||
    typeof objective.value !== "number" ||
    !Number.isFinite(objective.value) ||
    objective.value < 0 ||
    objective.value > 1 ||
    typeof objective.window !== "string"
  )
    return undefined;
  const labels: Record<string, string> = {};
  if (payload.labels !== undefined && !Array.isArray(payload.labels)) return undefined;
  for (const item of (payload.labels ?? []) as unknown[]) {
    if (
      !isRecord(item) ||
      typeof item.key !== "string" ||
      typeof item.value !== "string" ||
      Object.hasOwn(labels, item.key)
    )
      return undefined;
    Object.defineProperty(labels, item.key, { value: item.value, enumerable: true });
  }
  const query = payload.query;
  const rawBody = typeof query.type === "string" ? query[query.type] : undefined;
  const body = isRecord(rawBody) ? rawBody : undefined;
  const destination: Record<string, unknown> = isRecord(payload.destinationDatasource)
    ? payload.destinationDatasource
    : {};
  const datasourceUid =
    typeof body?.sourceDatasourceUid === "string" ? body.sourceDatasourceUid : destination.uid;
  return Object.freeze({
    uid: payload.uuid,
    name: payload.name,
    objective: objective.value * 100,
    window: objective.window,
    labels: Object.freeze(labels),
    query: Object.freeze({ ...query }),
    ...(typeof datasourceUid === "string" && datasourceUid.length > 0 ? { datasourceUid } : {})
  });
}
export function indicatorQueries(slo: SloSnapshot): readonly string[] | undefined {
  const query = slo.query;
  if (
    query.type === "freeform" &&
    isRecord(query.freeform) &&
    typeof query.freeform.query === "string" &&
    query.freeform.query.trim().length > 0
  )
    return [query.freeform.query];
  if (query.type === "ratio" && isRecord(query.ratio)) {
    const { successMetric, totalMetric } = query.ratio;
    if (
      isRecord(successMetric) &&
      isRecord(totalMetric) &&
      typeof successMetric.prometheusMetric === "string" &&
      successMetric.prometheusMetric.trim().length > 0 &&
      typeof totalMetric.prometheusMetric === "string" &&
      totalMetric.prometheusMetric.trim().length > 0
    )
      return [successMetric.prometheusMetric, totalMetric.prometheusMetric];
  }
  return undefined;
}
