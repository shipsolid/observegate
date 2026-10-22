import type { Evidence } from "@observability-gate/core";
import { metric, scalar, traceRecords, type TelemetryResolver } from "./telemetry.js";
import {
  array,
  combined,
  configuration,
  number,
  record,
  string,
  type Context,
  type Data
} from "./shared.js";

export async function resolveComparison(
  base: TelemetryResolver,
  kind: string,
  definition: Data,
  context: Context
): Promise<readonly Evidence<unknown>[] | undefined> {
  if (!kind.startsWith("comparison.")) return undefined;
  const source = record(definition.source),
    a = record(definition.assertions),
    candidate = record(source.candidate ?? definition.candidate),
    baseline = record(source.baseline ?? definition.baseline);
  const candidateId = string(candidate.release_id) ?? context.releaseId,
    configuredId = string(baseline.release_id),
    baselineId =
      configuredId === undefined || configuredId === "release.baseline"
        ? string(record(base.policy.release.baseline).explicit_release_id)
        : configuredId;
  if (candidateId === undefined || baselineId === undefined || candidateId === baselineId)
    configuration(
      `${kind} requires distinct candidate and explicit baseline release IDs; previous healthy release must be supplied by verified deployment evidence`
    );
  const candidateContext = { ...context, releaseId: candidateId };
  const baselineContext = { ...context, releaseId: baselineId };
  const raws: Evidence<unknown>[] = [];
  async function comparison(config: Data, name?: string): Promise<Data> {
    const cq = record(config.candidate),
      bq = record(config.baseline),
      candidateQuery = cq.query ?? config.candidate_query,
      baselineQuery = bq.query ?? config.baseline_query;
    if (typeof candidateQuery !== "string" || typeof baselineQuery !== "string")
      configuration(
        `${kind}${name === undefined ? "" : ` (${name})`} requires explicit candidate.query and baseline.query; metric aliases do not define backend queries`
      );
    const c = await metric(base, candidateQuery, candidateContext),
      b = await metric(base, baselineQuery, baselineContext);
    raws.push(c, b);
    const minimumCandidateRequests = number(a.minimum_candidate_requests),
      minimumBaselineRequests = number(a.minimum_baseline_requests),
      normalized =
        kind === "comparison.multi_metric" ||
        kind === "comparison.telemetry_volume" ||
        a.normalized_per_request === true;
    const crq = cq.request_count_query ?? config.candidate_request_count_query,
      brq = bq.request_count_query ?? config.baseline_request_count_query;
    if (
      ((normalized || minimumCandidateRequests !== undefined) && typeof crq !== "string") ||
      ((normalized || minimumBaselineRequests !== undefined) && typeof brq !== "string")
    )
      configuration(
        `${kind} requires independent candidate and baseline request_count_query for traffic checks or normalization`
      );
    const cr =
        typeof crq === "string"
          ? await metric(base, crq, candidateContext)
          : undefined,
      br =
        typeof brq === "string"
          ? await metric(base, brq, baselineContext)
          : undefined;
    if (cr) raws.push(cr);
    if (br) raws.push(br);
    const unit = string(config.unit ?? a.unit ?? record(a.absolute_increase).unit) ?? "value";
    return {
      candidate: {
        value: scalar(c),
        unit,
        samples: c.value?.sampleCount ?? 0,
        requests: cr === undefined ? undefined : scalar(cr),
        releaseId: candidateId
      },
      baseline: {
        value: scalar(b),
        unit,
        samples: b.value?.sampleCount ?? 0,
        requests: br === undefined ? undefined : scalar(br),
        releaseId: baselineId
      },
      minimumCandidateSamples: number(a.minimum_candidate_samples) ?? 1,
      minimumBaselineSamples: number(a.minimum_baseline_samples) ?? 1,
      minimumCandidateRequests,
      minimumBaselineRequests,
      normalizedPerRequest: normalized,
      direction:
        a.absolute_decrease_percentage_points === undefined ? "increase_bad" : "decrease_bad",
      maximumAbsoluteRegression:
        number(a.maximum_absolute_regression) ??
        number(
          record(
            a.absolute_increase ??
              a.absolute_increase_percentage_points ??
              a.absolute_decrease_percentage_points
          ).less_than_or_equal
        ),
      maximumRelativeRegressionPercent:
        number(a.maximum_relative_regression_percent) ??
        number(record(a.relative_increase_percent).less_than_or_equal) ??
        number(record(a.relative_increase_percent)[name ?? ""]),
      window: source.window
    };
  }
  let value: Data;
  if (kind === "comparison.metric") value = await comparison(source);
  else if (kind === "comparison.trace_metrics") {
    const dependencies = array(a.dependencies).map(String);
    if (dependencies.length === 0)
      configuration("comparison.trace_metrics requires assertions.dependencies");
    const c = await traceRecords(
        base,
        { ...source, query: { "resource.service.version": candidateId } },
        candidateContext
      ),
      b = await traceRecords(
        base,
        { ...source, query: { "resource.service.version": baselineId } },
        baselineContext
      );
    raws.push(c, b);
    const quantile = (values: number[]) =>
      values.sort((l, r) => l - r)[Math.max(0, Math.ceil(values.length * 0.95) - 1)];
    value = {
      expectedDependencies: dependencies,
      dependencies: dependencies.map((name) => {
        const cv =
            c.value?.traces
              .flatMap((t) => t.spans)
              .filter((s) => s.peerService === name && s.durationMs !== undefined)
              .flatMap((s) => s.durationMs === undefined ? [] : [s.durationMs]) ?? [],
          bv =
            b.value?.traces
              .flatMap((t) => t.spans)
              .filter((s) => s.peerService === name && s.durationMs !== undefined)
              .flatMap((s) => s.durationMs === undefined ? [] : [s.durationMs]) ?? [];
        return {
          name,
          comparison: {
            candidate: {
              value: quantile(cv),
              unit: "milliseconds",
              samples: cv.length,
              releaseId: candidateId
            },
            baseline: {
              value: quantile(bv),
              unit: "milliseconds",
              samples: bv.length,
              releaseId: baselineId
            },
            minimumCandidateSamples: 1,
            minimumBaselineSamples: 1,
            maximumRelativeRegressionPercent: number(
              record(a.p95_relative_increase_percent).less_than_or_equal
            ),
            maximumAbsoluteRegression:
              1000 * (number(record(a.p95_absolute_increase).less_than_or_equal) ?? Infinity)
          }
        };
      })
    };
  } else {
    const queries = record(source.queries);
    if (Object.keys(queries).length === 0)
      configuration(
        `${kind} requires source.queries entries with candidate.query, baseline.query, unit and independent request_count_query`
      );
    const comparisons = [];
    for (const [name, config] of Object.entries(queries))
      comparisons.push(await comparison(record(config), name));
    value = { comparisons };
  }
  return [combined(raws, kind, value), ...raws];
}
