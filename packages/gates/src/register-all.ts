import { GateCatalog } from "./catalog/registry.js";
import { registerContainerAppsGates } from "./register-container-apps.js";
import { registerKubernetesGates } from "./register-kubernetes.js";
import { registerPostCommonGates } from "./register-post-common.js";
import { registerPostReliabilityGates } from "./register-post-reliability.js";
import { registerReadinessGates } from "./register-readiness.js";
import { registerRiskGates } from "./register-risk.js";
import { registerVmGates } from "./register-vm.js";

export function createBuiltInGateCatalog(): GateCatalog {
  const catalog = new GateCatalog();
  registerReadinessGates(catalog);
  registerRiskGates(catalog);
  registerPostCommonGates(catalog);
  registerPostReliabilityGates(catalog);
  registerKubernetesGates(catalog);
  registerContainerAppsGates(catalog);
  registerVmGates(catalog);
  return catalog;
}
