import { assertion, createEvidenceGate } from "../evaluation.js";

export const telemetryPresenceGate = createEvidenceGate({
  type: "telemetry.presence",
  description: "Require telemetry records matching canonical candidate identity.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const records = typeof value.records === "number" ? value.records : 0;
    const minimum = typeof value.minimumRecords === "number" ? value.minimumRecords : 1;
    return [
      assertion(
        "matching identity",
        value.identityMatches === true,
        "Telemetry matches canonical candidate identity"
      ),
      assertion(
        "records present",
        records >= minimum,
        "Candidate telemetry records are present",
        records,
        minimum
      )
    ];
  }
});
