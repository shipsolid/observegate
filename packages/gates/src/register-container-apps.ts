import type { GateCatalog } from "./catalog/registry.js";
import {
  containerAppsImageIdentityGate,
  containerAppsReplicaHealthGate,
  containerAppsRevisionStatusGate,
  containerAppsTrafficGate
} from "./platform/container-apps/post.js";
import {
  containerAppsConfigurationGate,
  containerAppsProbesGate
} from "./platform/container-apps/pre.js";

export function registerContainerAppsGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    containerAppsConfigurationGate,
    containerAppsProbesGate,
    containerAppsRevisionStatusGate,
    containerAppsImageIdentityGate,
    containerAppsTrafficGate,
    containerAppsReplicaHealthGate
  ])
    catalog.register(gate);
  return catalog;
}
