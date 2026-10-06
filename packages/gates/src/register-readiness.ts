import type { GateCatalog } from "./catalog/registry.js";
import {
  alertRulesGate,
  assetMetadataGate,
  assetUrlGate,
  dashboardGate,
  notificationPolicyGate,
  sloDefinitionGate
} from "./pre/readiness/assets.js";
import { collectorConfigurationGate } from "./pre/readiness/collector-config.js";
import { policyCoverageGate } from "./pre/readiness/coverage.js";
import { identityContractGate } from "./pre/readiness/identity.js";
import {
  instrumentationConfigurationGate,
  sarifEvidenceGate
} from "./pre/readiness/instrumentation.js";
import { policySelfCheckGate } from "./pre/readiness/policy.js";
import { queryValidationGate } from "./pre/readiness/queries.js";
import { syntheticPlanGate } from "./pre/readiness/synthetic-plan.js";
import { otlpContractGate } from "./pre/readiness/telemetry-contract.js";

export function registerReadinessGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    policySelfCheckGate,
    identityContractGate,
    assetMetadataGate,
    assetUrlGate,
    dashboardGate,
    alertRulesGate,
    notificationPolicyGate,
    sloDefinitionGate,
    queryValidationGate,
    instrumentationConfigurationGate,
    sarifEvidenceGate,
    otlpContractGate,
    collectorConfigurationGate,
    syntheticPlanGate,
    policyCoverageGate
  ])
    catalog.register(gate);
  return catalog;
}
