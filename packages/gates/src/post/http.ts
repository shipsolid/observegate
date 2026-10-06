import { assertion, createEvidenceGate } from "../evaluation.js";

export const httpAssertionGate = createEvidenceGate({
  type: "http.assertion",
  description: "Evaluate status, latency, headers, and JSON from guarded HTTP probe evidence.",
  phases: ["post_deployment"],
  providerRequirements: [{ provider: "http", capability: "probe", required: true }],
  evaluate(_definition, value) {
    const statuses = Array.isArray(value.expectedStatuses) ? value.expectedStatuses : [];
    const duration =
      typeof value.durationMs === "number" ? value.durationMs : Number.POSITIVE_INFINITY;
    const maximum = typeof value.maximumDurationMs === "number" ? value.maximumDurationMs : 0;
    return [
      assertion(
        "status",
        statuses.includes(value.status),
        "HTTP status is allowed",
        value.status,
        statuses
      ),
      assertion(
        "duration",
        duration <= maximum,
        "HTTP duration is within policy",
        duration,
        maximum
      ),
      assertion("response headers", value.headersMatch === true, "Expected response headers match"),
      assertion("response JSON", value.jsonMatches === true, "Expected response JSON matches")
    ];
  }
});
