import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const queryValidationGate = createEvidenceGate({
  type: "telemetry.query_validation",
  description: "Validate bounded and scoped telemetry queries.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const queries = Array.isArray(value.queries) ? (value.queries as EvidenceRecord[]) : [];
    const forbidden = new Set(["user_id", "session_id", "request_id", "trace_id"]);
    return [
      assertion(
        "queries compile",
        queries.length > 0 && queries.every((query) => query.valid === true),
        "Every configured query compiles"
      ),
      assertion(
        "scalar threshold shape",
        queries.every((query) => query.threshold !== true || query.shape === "scalar"),
        "Threshold queries return scalars"
      ),
      assertion(
        "identity scope",
        queries.every((query) => query.production !== true || query.scoped === true),
        "Production queries include service and environment scope"
      ),
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
