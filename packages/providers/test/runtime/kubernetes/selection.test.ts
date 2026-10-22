import { describe, expect, it } from "vitest";
import { parseKubernetesManifest, normalizeKubernetesSnapshot } from "../../../src/index.js";

const selector = { kind: "Deployment" as const, name: "app", namespace: "shop" };
function manifest(budgets: unknown[] = [], kind = "Deployment") {
  return [
    {
      apiVersion: "apps/v1",
      kind,
      metadata: { name: "app", namespace: "shop" },
      spec: {
        replicas: 3,
        updateStrategy: { type: "RollingUpdate", rollingUpdate: { partition: 0 } },
        template: {
          metadata: { labels: { app: "checkout", tier: "api" } },
          spec: {
            containers: [
              { name: "sidecar", image: "sidecar:v1", resources: { requests: { cpu: "1" } } },
              { name: "checkout", image: "checkout:v2" }
            ]
          }
        }
      }
    },
    ...budgets
  ]
    .map((v) => JSON.stringify(v))
    .join("\n---\n");
}
function pdb(selectorValue: unknown, minAvailable = 2) {
  return {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { namespace: "shop" },
    spec: { selector: selectorValue, minAvailable }
  };
}

describe("Kubernetes workload evidence selection", () => {
  it("selects the named application rather than the first sidecar", () => {
    expect(
      parseKubernetesManifest(manifest(), { ...selector, container: "checkout" })
    ).toMatchObject({ image: "checkout:v2", resources: {}, containerIndex: 1 });
  });
  it("rejects ambiguous and missing containers", () => {
    expect(() => parseKubernetesManifest(manifest(), selector)).toThrow(/container/i);
    expect(() =>
      parseKubernetesManifest(manifest(), { ...selector, container: "missing" })
    ).toThrow(/container/i);
  });
  it("ignores unrelated PDBs and associates expression selectors", () => {
    const value = parseKubernetesManifest(
      manifest([
        pdb({ matchLabels: { app: "other" } }),
        pdb({
          matchExpressions: [
            { key: "app", operator: "In", values: ["checkout"] },
            { key: "tier", operator: "Exists" },
            { key: "disabled", operator: "DoesNotExist" },
            { key: "tier", operator: "NotIn", values: ["batch"] }
          ]
        })
      ]),
      { ...selector, container: "checkout" }
    );
    expect(value.disruptionBudget).toMatchObject({ minAvailable: 2 });
    expect(
      parseKubernetesManifest(manifest([pdb({ matchLabels: { app: "other" } })]), {
        ...selector,
        container: "checkout"
      }).disruptionBudget
    ).toBeUndefined();
  });
  it("preserves policy/v1 empty-selector semantics and rejects malformed expressions", () => {
    expect(
      parseKubernetesManifest(manifest([pdb({})]), { ...selector, container: "checkout" })
        .disruptionBudget
    ).toMatchObject({ minAvailable: 2 });
    expect(() =>
      parseKubernetesManifest(
        manifest([pdb({ matchExpressions: [{ key: "app", operator: "NotIn", values: [] }] })]),
        { ...selector, container: "checkout" }
      )
    ).toThrow(/selector/i);
  });
  it("rejects overlapping PDBs", () => {
    expect(() =>
      parseKubernetesManifest(manifest([pdb({}), pdb({ matchLabels: { app: "checkout" } })]), {
        ...selector,
        container: "checkout"
      })
    ).toThrow(/disruption/i);
  });
  it("preserves StatefulSet updateStrategy and implicit replicas", () => {
    expect(
      parseKubernetesManifest(manifest([], "StatefulSet"), {
        ...selector,
        kind: "StatefulSet",
        container: "checkout"
      })
    ).toMatchObject({
      workloadKind: "StatefulSet",
      strategy: "RollingUpdate",
      maxUnavailable: 1,
      partition: 0
    });
  });
  it("uses readyReplicas when StatefulSet availableReplicas is absent", () => {
    const result = normalizeKubernetesSnapshot({
      workload: {
        kind: "StatefulSet",
        metadata: { uid: "s", name: "app", namespace: "shop", generation: 1 },
        spec: {},
        status: {
          observedGeneration: 1,
          readyReplicas: 1,
          updatedReplicas: 1,
          currentRevision: "v2",
          updateRevision: "v2"
        }
      },
      replicaSets: [],
      pods: [],
      events: [],
      observedAt: "2026-10-22T00:00:00Z"
    });
    expect(result.rollout.replicas).toEqual({
      desired: 1,
      updated: 1,
      ready: 1,
      available: 1,
      unavailable: 0
    });
    expect(result.rollout).toMatchObject({ currentRevision: "v2", updateRevision: "v2" });
  });
});
