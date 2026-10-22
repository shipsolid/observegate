import { stableFingerprint, type Evidence, type Phase } from "@observability-gate/core";
import {
  logRecords,
  metric,
  traceRecords,
  windowFor,
  type TelemetryResolver
} from "./telemetry.js";
import {
  array,
  combined,
  configuration,
  durationMs,
  evidence,
  record,
  string,
  type Context,
  type Data
} from "./shared.js";

type Signal = "metrics" | "logs" | "traces";
interface Query {
  readonly signal: Signal;
  readonly query: string | Data;
  readonly fingerprint: string;
  readonly source: Data;
  phase: Phase;
  threshold: boolean;
  requestRangeMs: number;
}
const signals = new Set<Signal>(["metrics", "logs", "traces"]);
function signal(value: unknown): Signal | undefined {
  return typeof value === "string" && signals.has(value as Signal) ? (value as Signal) : undefined;
}
function defaultSignal(gate: Data): Signal | undefined {
  const provider = record(gate.source).provider;
  if (signal(provider)) return signal(provider);
  const kind = String(gate.type);
  if (kind.startsWith("trace.") || kind === "comparison.trace_metrics") return "traces";
  if (kind.startsWith("log.")) return "logs";
  if (
    /^(?:metric\.|comparison\.|grafana\.|runtime\.)/u.test(kind) ||
    [
      "dependency.health",
      "telemetry.collector_health",
      "telemetry.cardinality_estimate",
      "telemetry.volume_estimate"
    ].includes(kind)
  )
    return "metrics";
  return undefined;
}
function duration(value: string): number {
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d|w|y)/gu)];
  if (parts.length === 0 || parts.map((p) => p[0]).join("") !== value) return Number.NaN;
  return parts.reduce(
    (total, part) =>
      total +
      Number(part[1]) *
        ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31536000000 }[
          part[2] ?? ""
        ] ?? Number.NaN),
    0
  );
}
function unquoted(query: string): string {
  return query.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/gu, '""');
}
function lookbackMs(query: string): number {
  const text = unquoted(query);
  // Absolute @ timestamps and negative offsets cannot establish a bounded lookback here.
  if (text.includes("@") || /\boffset\s*-/u.test(text)) return Number.NaN;
  const selectors = [...text.matchAll(/\[([^\]]*)\]/gu)].map((match) =>
    duration(String(match[1]).split(":")[0] ?? "")
  );
  const offsets = [...text.matchAll(/\boffset\s+([\d.]+[a-z\d.]*)/gu)].map((match) =>
    duration(match[1] ?? "")
  );
  // Summing selectors is a conservative upper bound for nested subqueries and offsets.
  return [...selectors, ...offsets].reduce((total, part) => total + part, 0);
}
function selectors(query: string): string[] {
  const found: string[] = [];
  let quote: string | undefined;
  let start: number | undefined;
  for (let index = 0; index < query.length; index++) {
    const character = query[index];
    if (quote !== undefined) {
      if (character === "\\" && quote !== "`") index++;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") start = index + 1;
    else if (character === "}" && start !== undefined) {
      found.push(query.slice(start, index));
      start = undefined;
    }
  }
  return found;
}
function hasBareVector(query: string): boolean {
  const residual = unquoted(query)
    .replace(/(?:[a-zA-Z_:][\w:]*\s*)?\{[^{}]*\}/gu, "0")
    .replace(/\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\boffset\s+-?[\d.]+[a-z\d.]*/gu, "")
    .replace(/\b[a-zA-Z_][\w]*\s*(?=\()/gu, "")
    .replace(/\b(?:and|or|unless|bool|Inf|NaN)\b/gu, "")
    .replace(/\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/gu, "");
  // Unknown bare identifiers cannot prove tenant scope without a full PromQL parser.
  return /[a-zA-Z_:][\w:]*/u.test(residual);
}
function matchers(selector: string): { label: string; operator: string; value: string }[] {
  return [...selector.matchAll(/([a-zA-Z_][\w]*)\s*(=~|!=|!~|=)\s*("(?:\\.|[^"\\])*")/gu)].map(
    (match) => ({
      label: match[1] ?? "",
      operator: match[2] ?? "",
      value: JSON.parse(match[3] ?? '""') as string
    })
  );
}
function scoped(base: TelemetryResolver, query: Query): boolean {
  const expected = record(base.policy.identity.canonical);
  if (query.signal === "traces") {
    const selector = record(query.query);
    return (
      (selector["resource.service.name"] ?? expected.service_name) === expected.service_name &&
      (selector["resource.deployment.environment.name"] ?? expected.environment) ===
        expected.environment
    );
  }
  const mapping = record(record(base.policy.identity.provider_mappings)[query.signal]);
  const service =
    string(mapping["service.name"]) ?? (query.signal === "metrics" ? "service_name" : "service");
  const environment =
    string(mapping["deployment.environment.name"]) ??
    (query.signal === "metrics" ? "deployment_environment" : "environment");
  const streamSelectors = selectors(String(query.query));
  if (query.signal === "metrics" && hasBareVector(String(query.query))) return false;
  return (
    streamSelectors.length > 0 &&
    streamSelectors.every((selector) => {
      const labels = matchers(selector);
      return (
        labels.some(
          (m) => m.label === service && m.operator === "=" && m.value === expected.service_name
        ) &&
        labels.some(
          (m) => m.label === environment && m.operator === "=" && m.value === expected.environment
        )
      );
    })
  );
}
function boundedLog(query: string): boolean {
  return selectors(query).some((selector) =>
    matchers(selector).some((m) => {
      if (m.operator === "=") return m.value.length > 0;
      if (m.operator !== "=~") return false;
      try {
        return !new RegExp(`^(?:${m.value})$`, "u").test("");
      } catch {
        return false;
      }
    })
  );
}
function collect(base: TelemetryResolver, definition: Data, context: Context): readonly Query[] {
  const a = record(definition.assertions);
  const scopes =
    a.validate_queries_from === undefined
      ? ["gates.pre_deployment", "gates.post_deployment"]
      : array(a.validate_queries_from);
  if (scopes.some((scope) => scope !== "gates.pre_deployment" && scope !== "gates.post_deployment"))
    configuration("Query validation scope must be gates.pre_deployment or gates.post_deployment");
  const sources = record(definition.sources);
  if (Object.entries(sources).some(([key, value]) => signal(key) === undefined || value !== key))
    configuration(
      "Query validation sources must select the canonical metrics, logs, or traces provider"
    );
  const allowed = Object.keys(sources).length === 0 ? signals : new Set(Object.keys(sources));
  const found = new Map<string, Query>();
  for (const scope of new Set(scopes)) {
    const phase: Phase = scope === "gates.pre_deployment" ? "pre_deployment" : "post_deployment";
    for (const gate of array(base.policy.gates[phase]).map(record)) {
      if (gate.type === "telemetry.query_validation") continue;
      const source = record(gate.source);
      const fallback = defaultSignal(gate);
      const threshold = gate.type === "metric.threshold" || gate.type === "metric.multi_threshold";
      const add = (backend: Signal | undefined, value: unknown) => {
        if (backend === undefined)
          configuration("Cannot determine telemetry backend for a selected query");
        if (!allowed.has(backend)) return;
        if (backend === "traces" && typeof value === "string")
          configuration(
            "Raw TraceQL query validation is unsupported; use the supported trace identity selector"
          );
        if (backend !== "traces" && (typeof value !== "string" || value.trim().length === 0))
          configuration("Selected metric and log queries must be nonempty strings");
        const query = typeof value === "string" ? value : record(value);
        const queryContext = { ...context, phase };
        const range = windowFor(base, queryContext);
        const configuredWindow = source.window ?? gate.window;
        const requested =
          configuredWindow === undefined
            ? 0
            : typeof configuredWindow === "string"
              ? duration(configuredWindow)
              : Number.NaN;
        const requestRangeMs = Math.max(
          requested,
          backend === "metrics" && gate.type !== "metric.range"
            ? 0
            : Date.parse(range.end) - Date.parse(range.start)
        );
        const fingerprint = stableFingerprint({ backend, query });
        const previous = found.get(fingerprint);
        if (previous !== undefined) {
          previous.threshold ||= threshold;
          if (requestRangeMs > previous.requestRangeMs) {
            previous.requestRangeMs = requestRangeMs;
            previous.phase = phase;
          }
        } else
          found.set(fingerprint, {
            signal: backend,
            query,
            fingerprint,
            source,
            phase,
            threshold,
            requestRangeMs
          });
      };
      const walk = (value: unknown, backend: Signal | undefined, depth: number): void => {
        if (depth > 32) configuration("Query definition nesting exceeds the supported bound");
        if (Array.isArray(value)) {
          for (const child of value) walk(child, backend, depth + 1);
          return;
        }
        const node = record(value);
        const local = signal(node.provider) ?? backend;
        for (const [key, child] of Object.entries(node)) {
          if (key === "query" || key.endsWith("_query")) {
            add(
              key === "short_query" ||
                key === "long_query" ||
                key.endsWith("request_count_query") ||
                key === "runtime_release_query"
                ? "metrics"
                : local,
              child
            );
            continue;
          }
          if (key === "queries" || key === "probes") {
            for (const [name, item] of Object.entries(record(child))) {
              const hint = signal(name) ?? local;
              if (
                typeof item === "string" ||
                (hint === "traces" &&
                  Object.keys(record(item)).some((k) => k.startsWith("resource.")))
              )
                add(hint, item);
              else if (key === "probes" && hint === "traces" && record(item).query === undefined)
                add("traces", {});
              else walk(item, hint, depth + 1);
            }
            continue;
          }
          if (child !== null && typeof child === "object") walk(child, local, depth + 1);
        }
      };
      walk(gate, fallback, 0);
      if (
        fallback === "traces" &&
        source.query === undefined &&
        !found.has(stableFingerprint({ backend: "traces", query: {} }))
      )
        add("traces", {});
    }
  }
  if (found.size === 0)
    configuration(
      "Query validation requires at least one query in the selected scopes and sources"
    );
  return [...found.values()];
}
export async function resolveQueryValidation(
  base: TelemetryResolver,
  definition: Data,
  context: Context
): Promise<readonly Evidence<unknown>[]> {
  const a = record(definition.assertions);
  const maximum =
    a.maximum_query_range === undefined ? Infinity : durationMs(a.maximum_query_range, Number.NaN);
  if (!(maximum > 0))
    configuration("Query validation maximum_query_range must be a positive supported duration");
  const queries: Data[] = [];
  const raws: Evidence<unknown>[] = [];
  for (const query of collect(base, definition, context)) {
    const rangeMs =
      query.requestRangeMs + (typeof query.query === "string" ? lookbackMs(query.query) : 0);
    const bounded = query.signal !== "logs" || boundedLog(String(query.query));
    const withinRange = Number.isFinite(rangeMs) && rangeMs <= maximum;
    let raw: Evidence<unknown> | undefined;
    if (
      (maximum === Infinity || withinRange) &&
      (a.reject_unbounded_log_queries !== true || bounded)
    ) {
      const queryContext = { ...context, phase: query.phase };
      raw =
        query.signal === "metrics"
          ? await metric(base, query.query, queryContext)
          : query.signal === "logs"
            ? await logRecords(base, query.query, queryContext)
            : await traceRecords(base, { ...query.source, query: query.query }, queryContext);
    }
    const value = record(raw?.value);
    // A successfully parsed empty/stale response proves compilation, not telemetry health.
    const valid =
      raw !== undefined &&
      raw.value !== undefined &&
      ["valid", "missing", "stale", "insufficient"].includes(raw.state);
    const groupBy =
      typeof query.query !== "string"
        ? []
        : [...unquoted(query.query).matchAll(/\bby\s*\(([^)]*)\)/gu)].flatMap((match) =>
            String(match[1])
              .split(",")
              .map((label) => label.trim())
              .filter((label) => /^[a-zA-Z_][\w]*$/u.test(label))
          );
    const summary = {
      fingerprint: query.fingerprint,
      signal: query.signal,
      valid,
      threshold: query.threshold,
      shape:
        query.signal === "metrics"
          ? array(value.samples).length === 1
            ? "scalar"
            : "vector"
          : query.signal === "logs"
            ? "records"
            : "traces",
      production: record(base.policy.identity.canonical).environment === "production",
      scoped: scoped(base, query),
      bounded,
      groupBy,
      ...(Number.isFinite(rangeMs) ? { rangeMs } : {}),
      rangeSupported: Number.isFinite(rangeMs)
    };
    queries.push(summary);
    const normalized = evidence(
      "telemetry.query-validation.query",
      context,
      new Date(base.now()).toISOString(),
      summary,
      query.signal,
      "query.validate"
    );
    raws.push(
      Object.freeze({
        ...normalized,
        ...(raw !== undefined && !valid
          ? {
              state: raw.state,
              diagnostics: Object.freeze(
                raw.diagnostics.map((d) => ({
                  code: d.code,
                  retryable: d.retryable,
                  message: "Telemetry backend could not validate a selected query"
                }))
              )
            }
          : {})
      })
    );
  }
  return [combined(raws, "telemetry.query_validation", { queries }), ...raws];
}
