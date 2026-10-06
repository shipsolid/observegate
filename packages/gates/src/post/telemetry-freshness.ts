import { assertion, createEvidenceGate, type EvidenceRecord } from "../evaluation.js";

export const telemetryFreshnessGate = createEvidenceGate({
  type: "telemetry.freshness",
  description: "Evaluate freshness and future skew independently for every telemetry signal.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const signals = Array.isArray(value.signals) ? (value.signals as EvidenceRecord[]) : [];
    if (signals.length === 0) {
      return [
        assertion("required signals", false, "Freshness evidence contains telemetry signals", 0)
      ];
    }
    return signals.flatMap((signal) => {
      const name = String(signal.name ?? "unknown");
      const age = typeof signal.ageMs === "number" ? signal.ageMs : Number.POSITIVE_INFINITY;
      const maximumAge = typeof signal.maximumAgeMs === "number" ? signal.maximumAgeMs : 0;
      const futureSkew =
        typeof signal.futureSkewMs === "number" ? signal.futureSkewMs : Number.POSITIVE_INFINITY;
      const maximumFutureSkew =
        typeof signal.maximumFutureSkewMs === "number" ? signal.maximumFutureSkewMs : 0;
      return [
        assertion(
          `${name} freshness`,
          age <= maximumAge,
          `${name} telemetry is fresh`,
          age,
          maximumAge
        ),
        assertion(
          `${name} future skew`,
          futureSkew <= maximumFutureSkew,
          `${name} timestamps are within future-skew policy`,
          futureSkew,
          maximumFutureSkew
        )
      ];
    });
  }
});
