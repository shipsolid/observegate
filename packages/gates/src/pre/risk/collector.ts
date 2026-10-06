import { assertion, createEvidenceGate } from "../../evaluation.js";

export const collectorHealthGate = createEvidenceGate({
  type: "telemetry.collector_health",
  description: "Evaluate collector failures, refusals, queues, and freshness.",
  phases: ["pre_deployment", "post_deployment"],
  evaluate(_definition, value) {
    const failures =
      typeof value.exportFailures === "number" ? value.exportFailures : Number.POSITIVE_INFINITY;
    const refused =
      typeof value.refusedRecords === "number" ? value.refusedRecords : Number.POSITIVE_INFINITY;
    const queue =
      typeof value.maximumQueueUtilizationPercent === "number"
        ? value.maximumQueueUtilizationPercent
        : Number.POSITIVE_INFINITY;
    const maximumQueue =
      typeof value.allowedQueueUtilizationPercent === "number"
        ? value.allowedQueueUtilizationPercent
        : 80;
    return [
      assertion("export failures", failures === 0, "Collector has no export failures", failures, 0),
      assertion("refused records", refused === 0, "Collector has refused no records", refused, 0),
      assertion(
        "queue utilization",
        queue <= maximumQueue,
        "Collector queues remain within policy",
        queue,
        maximumQueue
      )
    ];
  }
});
