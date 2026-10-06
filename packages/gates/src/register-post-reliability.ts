import type { GateCatalog } from "./catalog/registry.js";
import { comparisonMultiMetricGate } from "./post/comparison/multi-metric.js";
import { comparisonMetricGate } from "./post/comparison/metric.js";
import { comparisonTelemetryVolumeGate } from "./post/comparison/telemetry-volume.js";
import { comparisonTraceMetricsGate } from "./post/comparison/trace-metrics.js";
import { httpAssertionGate } from "./post/http.js";
import { syntheticResultGate } from "./post/synthetic.js";
import { alertStateGate } from "./pre/risk/alerts-incidents.js";
import { dependencyHealthGate } from "./pre/risk/dependencies.js";
import { metricThresholdGate } from "./pre/risk/metrics.js";
import { burnRateGate, errorBudgetGate, sloStatusGate } from "./pre/risk/reliability.js";

export {
  selectBaseline,
  type BaselineCandidate,
  type BaselineSelection
} from "./post/comparison/baseline.js";
export { compareMetricValues, type MetricComparisonInput } from "./post/comparison/metric.js";

export function registerPostReliabilityGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    comparisonMetricGate,
    comparisonMultiMetricGate,
    comparisonTraceMetricsGate,
    comparisonTelemetryVolumeGate,
    sloStatusGate,
    errorBudgetGate,
    burnRateGate,
    alertStateGate,
    dependencyHealthGate,
    syntheticResultGate,
    httpAssertionGate,
    metricThresholdGate
  ]) {
    if (!catalog.has(gate.type)) catalog.register(gate);
  }
  return catalog;
}
