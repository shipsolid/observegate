import type { GateCatalog } from "./catalog/registry.js";
import {
  azureVmInstanceViewGate,
  vmAgentHealthGate,
  vmHostHealthGate,
  vmReleaseMarkerGate,
  vmServiceHealthGate
} from "./platform/vm/post.js";
import {
  vmCapacityGate,
  vmReleaseIdentityGate,
  vmServiceDefinitionGate
} from "./platform/vm/pre.js";

export { parseVmServiceDefinition, type VmServiceDefinition } from "./platform/vm/pre.js";

export function registerVmGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    vmReleaseIdentityGate,
    vmServiceDefinitionGate,
    vmCapacityGate,
    azureVmInstanceViewGate,
    vmServiceHealthGate,
    vmReleaseMarkerGate,
    vmHostHealthGate,
    vmAgentHealthGate
  ])
    catalog.register(gate);
  return catalog;
}
