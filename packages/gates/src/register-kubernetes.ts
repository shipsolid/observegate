import type { GateCatalog } from "./catalog/registry.js";
import {
  kubernetesEventsGate,
  kubernetesImageIdentityGate,
  kubernetesPodHealthGate,
  kubernetesRolloutStatusGate
} from "./platform/kubernetes/post.js";
import {
  kubernetesManifestGate,
  kubernetesProbesGate,
  kubernetesResourcesGate,
  kubernetesRolloutStrategyGate
} from "./platform/kubernetes/pre.js";

export function registerKubernetesGates(catalog: GateCatalog): GateCatalog {
  for (const gate of [
    kubernetesManifestGate,
    kubernetesProbesGate,
    kubernetesResourcesGate,
    kubernetesRolloutStrategyGate,
    kubernetesRolloutStatusGate,
    kubernetesImageIdentityGate,
    kubernetesPodHealthGate,
    kubernetesEventsGate
  ])
    catalog.register(gate);
  return catalog;
}
