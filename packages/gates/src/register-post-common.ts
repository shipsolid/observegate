import type { GateCatalog } from "./catalog/registry.js";
import { metricMultiThresholdGate, runtimeStabilityGate } from "./post/release-health.js";
import { telemetryContractGate } from "./post/telemetry-contract.js";
import {
  telemetryCorrelationGate,
  telemetryServiceGraphGate
} from "./post/telemetry-correlation.js";
import { telemetryFreshnessGate } from "./post/telemetry-freshness.js";
import { telemetryIdentityGate } from "./post/telemetry-identity.js";
import { telemetryPresenceGate } from "./post/telemetry-presence.js";
import {
  runtimeProvisionedGate,
  runtimeReadyGate,
  runtimeReleaseIdentityGate
} from "./post/workload.js";
import { collectorHealthGate } from "./pre/risk/collector.js";
import { metricThresholdGate } from "./pre/risk/metrics.js";

export function registerPostCommonGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    runtimeProvisionedGate,
    runtimeReadyGate,
    runtimeReleaseIdentityGate,
    metricThresholdGate,
    telemetryPresenceGate,
    telemetryFreshnessGate,
    telemetryContractGate,
    telemetryIdentityGate,
    telemetryCorrelationGate,
    telemetryServiceGraphGate,
    collectorHealthGate,
    metricMultiThresholdGate,
    runtimeStabilityGate
  ]) {
    if (!catalog.has(gate.type)) catalog.register(gate);
  }
  return catalog;
}
