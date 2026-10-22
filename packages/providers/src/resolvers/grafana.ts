import type { Evidence } from "@observability-gate/core";
import type { GrafanaProvider } from "../grafana/types.js";
import { metric, scalar, type TelemetryResolver } from "./telemetry.js";
import {
  array,
  combined,
  configuration,
  durationMs,
  field,
  identity,
  invalid,
  mapped,
  number,
  record,
  string,
  type Context,
  type Data
} from "./shared.js";

export async function resolveGrafana(
  base: TelemetryResolver,
  grafana: GrafanaProvider | undefined,
  kind: string,
  definition: Data,
  context: Context
): Promise<readonly Evidence<unknown>[] | undefined> {
  if (!kind.startsWith("grafana.")) return undefined;
  if (grafana === undefined) configuration(`${kind} requires a configured grafana endpoint`);
  const source = record(definition.source),
    a = record(definition.assertions),
    request = {
      target: context.targetId,
      maximumAgeMs: durationMs(a.maximum_data_age, 600000),
      maximumFutureSkewMs: base.maximumFutureSkewMs,
      signal: context.signal
    };
  if (kind === "grafana.dashboard") {
    const uid = field(source, "uid", base.environment);
    if (uid === undefined) configuration("grafana.dashboard requires source.uid or source.uid_env");
    return [
      await grafana.getDashboard({
        ...request,
        uid,
        ...(typeof a.title_contains === "string" ? { expectedTitle: a.title_contains } : {})
      })
    ];
  }
  if (kind === "grafana.alert_rules" || kind === "grafana.alert_state") {
    const selector = Object.fromEntries(
      Object.entries(record(source.labels)).filter(
        (e): e is [string, string] => typeof e[1] === "string"
      )
    );
    if (kind === "grafana.alert_state") {
      if (grafana.getActiveAlerts === undefined)
        configuration("Grafana adapter must support read-only active alert snapshots");
      const raw = await grafana.getActiveAlerts({ ...request, selector }),
        deployedAt = string(a.require_started_after),
        severities = array(a.forbidden_severities).map(String);
      return [
        mapped(raw, kind, {
          fresh: raw.state === "valid",
          candidatePeriodOnly: deployedAt !== undefined,
          alerts: raw.value
            ?.filter(
              (alert) => severities.length === 0 || severities.includes(alert.labels.severity ?? "")
            )
            .map((alert) => ({
              ...alert,
              startedAfterDeployment:
                deployedAt === undefined
                  ? undefined
                  : Date.parse(alert.startsAt) >= Date.parse(deployedAt)
            }))
        })
      ];
    }
    const raw = await grafana.getAlertRules({ ...request, selector });
    return [mapped(raw, kind, { rules: raw.value })];
  }
  if (kind === "grafana.notification_policy") {
    const candidate = record(base.policy.release.candidate),
      start = string(candidate.deployed_at) ?? new Date(base.now()).toISOString();
    return [
      await grafana.getNotificationRoute({
        ...request,
        selector: Object.fromEntries(
          Object.entries(record(source.match)).filter(
            (e): e is [string, string] => typeof e[1] === "string"
          )
        ),
        requireUnmuted: a.mute_timing_does_not_cover_deployment_window !== false,
        verifyReceiver: a.receiver_is_configured === true,
        deploymentStart: start,
        deploymentEnd: new Date(
          base.now() +
            durationMs(record(base.policy.observation.post_deployment).evaluation_window, 600000)
        ).toISOString()
      })
    ];
  }
  const uid = field(source, "uid", base.environment);
  if (uid === undefined) configuration(`${kind} requires source.uid or source.uid_env`);
  const raw = await grafana.getSlo({
      ...request,
      uid,
      validateIndicatorQuery:
        kind === "grafana.slo_definition" && a.indicator_query_is_valid === true
    }),
    slo = raw.value;
  if (kind === "grafana.slo_definition") {
    const expected = identity(base.policy),
      labels = slo?.labels ?? {};
    return [
      mapped(raw, kind, {
        ...slo,
        labelsMatchIdentity:
          (labels.service ?? labels.service_name) === expected.serviceName &&
          (labels.environment ?? labels.deployment_environment) === expected.environment
      })
    ];
  }
  if (kind === "grafana.slo_status") {
    const query = record(source.queries).status;
    if (typeof query !== "string")
      configuration(
        "grafana.slo_status requires source.queries.status returning exactly 1 (met) or 0 (unmet)"
      );
    const measured = await metric(base, query, context);
    const status = scalar(measured);
    if (measured.state === "valid" && status !== 0 && status !== 1)
      invalid("grafana.slo_status query must return exactly 1 (met) or 0 (unmet)");
    return [
      combined([raw, measured], kind, {
        fresh: raw.state === "valid" && measured.state === "valid",
        status: status === 1 ? "met" : status === 0 ? "unmet" : undefined
      }),
      raw,
      measured
    ];
  }
  if (kind === "grafana.error_budget") {
    const maximumConsumed =
        number(a.maximum_consumed_during_release_percent) ??
        number(record(a.consumed_during_release_percent).less_than_or_equal),
      query = record(source.queries).release_consumed_percent;
    if (maximumConsumed !== undefined && typeof query !== "string")
      configuration(
        "Release-specific error-budget consumption requires source.queries.release_consumed_percent; Grafana cumulative consumedPercent cannot represent release consumption"
      );
    const remainingQuery = record(source.queries).remaining_percent;
    if (typeof remainingQuery !== "string")
      configuration(
        "grafana.error_budget requires source.queries.remaining_percent; the SLO definition API does not expose a measured budget"
      );
    const remaining = await metric(base, remainingQuery, context);
    const consumed = typeof query === "string" ? await metric(base, query, context) : undefined;
    return [
      combined(consumed === undefined ? [raw, remaining] : [raw, remaining, consumed], kind, {
        fresh:
          raw.state === "valid" &&
          remaining.state === "valid" &&
          (consumed === undefined || consumed.state === "valid"),
        remainingPercent: scalar(remaining),
        minimumRemainingPercent:
          number(a.minimum_remaining_percent) ??
          number(record(a.remaining_percent).greater_than_or_equal) ??
          0,
        ...(maximumConsumed === undefined
          ? {}
          : {
              maximumConsumedDuringReleasePercent: maximumConsumed,
              consumedDuringReleasePercent: consumed === undefined ? undefined : scalar(consumed)
            })
      }),
      raw,
      remaining,
      ...(consumed === undefined ? [] : [consumed])
    ];
  }
  if (kind === "grafana.burn_rate") {
    const windows = array(a.windows).map(record);
    if (windows.length === 0)
      configuration(
        "grafana.burn_rate requires assertions.windows with short_query, long_query and maximum"
      );
    const raws: Evidence<unknown>[] = [raw],
      pairs = [];
    for (const window of windows) {
      const short = await metric(base, window.short_query, context),
        long = await metric(base, window.long_query, context);
      raws.push(short, long);
      pairs.push({
        shortValue: scalar(short),
        longValue: scalar(long),
        maximum: number(window.maximum) ?? number(window.less_than_or_equal)
      });
    }
    return [combined(raws, kind, { fresh: raw.state === "valid", pairs }), ...raws];
  }
  return undefined;
}
