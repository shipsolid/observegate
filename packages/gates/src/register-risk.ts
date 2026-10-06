import type { GateCatalog } from "./catalog/registry.js";
import { alertStateGate, incidentStateGate } from "./pre/risk/alerts-incidents.js";
import { runtimeCapacityGate } from "./pre/risk/capacity.js";
import { changeWindowGate } from "./pre/risk/change-window.js";
import { collectorHealthGate } from "./pre/risk/collector.js";
import { deploymentConcurrencyGate } from "./pre/risk/concurrency.js";
import { dependencyHealthGate } from "./pre/risk/dependencies.js";
import { metricThresholdGate } from "./pre/risk/metrics.js";
import { providersHealthGate } from "./pre/risk/providers.js";
import { burnRateGate, errorBudgetGate, sloStatusGate } from "./pre/risk/reliability.js";
import {
  cardinalityEstimateGate,
  telemetryVolumeEstimateGate
} from "./pre/risk/telemetry-budget.js";

export { parseChangeWindowConfiguration } from "./pre/risk/change-window.js";

export function registerRiskGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    providersHealthGate,
    metricThresholdGate,
    sloStatusGate,
    errorBudgetGate,
    burnRateGate,
    alertStateGate,
    incidentStateGate,
    dependencyHealthGate,
    collectorHealthGate,
    runtimeCapacityGate,
    changeWindowGate,
    deploymentConcurrencyGate,
    cardinalityEstimateGate,
    telemetryVolumeEstimateGate
  ])
    catalog.register(gate);
  return catalog;
}
