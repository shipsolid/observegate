import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../../evaluation.js";

export const queryValidationGate = createEvidenceGate({
  type: "telemetry.query_validation",
  description: "Validate bounded and scoped telemetry queries.",
  phases: ["pre_deployment"],
  evaluate(definition, value) {
    const queries = Array.isArray(value.queries) ? (value.queries as EvidenceRecord[]) : [];
    const a = record(definition.assertions) ?? {};
    const forbidden = new Set(
      Array.isArray(a.reject_high_cardinality_grouping)
        ? a.reject_high_cardinality_grouping.map(String)
        : ["user_id", "session_id", "request_id", "trace_id"]
    );
    const duration =
      typeof a.maximum_query_range === "string"
        ? /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u.exec(a.maximum_query_range)
        : null;
    const maximumRange =
      duration === null
        ? Number.NaN
        : Number(duration[1]) *
          ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[duration[2] ?? ""] ?? Number.NaN);
    return [
      assertion(
        "queries compile",
        queries.length > 0 && queries.every((query) => query.valid === true),
        "Every configured query compiles"
      ),
      assertion(
        "scalar threshold shape",
        a.require_scalar_for_threshold_gates === false ||
          queries.every((query) => query.threshold !== true || query.shape === "scalar"),
        "Threshold queries return scalars"
      ),
      assertion(
        "identity scope",
        queries.every((query) => query.production !== true || query.scoped === true),
        "Production queries include service and environment scope"
      ),
      ...(a.reject_unbounded_log_queries !== true
        ? []
        : [
            assertion(
              "bounded log queries",
              queries.every((query) => query.signal !== "logs" || query.bounded === true),
              "Log queries have positive stream selectors and finite request bounds"
            )
          ]),
      ...(a.maximum_query_range === undefined
        ? []
        : [
            assertion(
              "maximum query range",
              queries.every(
                (query) =>
                  typeof query.rangeMs === "number" &&
                  Number.isFinite(query.rangeMs) &&
                  query.rangeMs <= maximumRange
              ),
              "Every query stays within the configured maximum range"
            )
          ]),
      assertion(
        "cardinality grouping",
        queries.every(
          (query) =>
            !Array.isArray(query.groupBy) ||
            query.groupBy.every((label) => !forbidden.has(String(label)))
        ),
        "Queries avoid high-cardinality grouping labels"
      )
    ];
  }
});
