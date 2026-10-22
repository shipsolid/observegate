import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "@observability-gate/core";
import { describe, expect, it } from "vitest";
import { createPolicyProviderSession, type ProviderPolicy } from "../../../src/session.js";
import type { KubernetesReadClient } from "../../../src/runtime/kubernetes/client.js";

const time = Date.now();
function policy(container: Record<string, string>): ProviderPolicy {
  return {
    identity: { canonical: { environment: "production" } },
    release: { candidate: { deployed_at: new Date(time - 1000).toISOString() } },
    observation: {},
    execution: { active_target: "app" },
    targets: {
      definitions: {
        app: {
          runtime: {
            type: "kubernetes",
            namespace: "shop",
            workload: { kind: "Deployment", name: "app", ...container }
          }
        }
      }
    },
    providers: {},
    gates: {},
    reporting: {},
    security: {},
    limits: {}
  };
}
function context(phase: "pre_deployment" | "post_deployment") {
  return {
    phase,
    targetId: "app",
    evidenceStore: new EvidenceStore(),
    signal: new AbortController().signal,
    clock: () => new Date(time)
  };
}

describe("Kubernetes provider acquisition", () => {
  it.each([{ container: "checkout" }, { container_env: "APP_CONTAINER" }])(
    "carries %j into static selection",
    async (container) => {
      const root = await mkdtemp(join(tmpdir(), "observegate-kube-"));
      try {
        await writeFile(
          join(root, "manifest.json"),
          JSON.stringify({
            kind: "Deployment",
            metadata: { name: "app", namespace: "shop" },
            spec: {
              template: {
                spec: {
                  containers: [
                    { name: "sidecar", image: "sidecar:v1", resources: { requests: { cpu: "1" } } },
                    { name: "checkout", image: "app:v2" }
                  ]
                }
              }
            }
          })
        );
        const session = createPolicyProviderSession({
          policy: policy(container),
          workspaceRoot: root,
          environment: { APP_CONTAINER: "checkout" },
          clock: () => time
        });
        const result = await session.resolveEvidence?.(
          "kubernetes.resources",
          { source: { files: ["manifest.json"] } },
          context("pre_deployment")
        );
        expect(result?.[0]?.value).toMatchObject({
          image: "app:v2",
          resources: {},
          containerIndex: 1
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
  it("rejects an unresolved configured container environment reference", async () => {
    const root = await mkdtemp(join(tmpdir(), "observegate-kube-"));
    try {
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({
          kind: "Deployment",
          metadata: { name: "app", namespace: "shop" },
          spec: { template: { spec: { containers: [{ name: "only", image: "app:v1" }] } } }
        })
      );
      const session = createPolicyProviderSession({
        policy: policy({ container_env: "MISSING" }),
        workspaceRoot: root,
        environment: {},
        clock: () => time
      });
      await expect(
        session.resolveEvidence?.(
          "kubernetes.resources",
          { source: { files: ["manifest.json"] } },
          context("pre_deployment")
        )
      ).rejects.toMatchObject({ code: "CONFIG_REFERENCE" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("carries named container selection into live image identity", async () => {
    const client: KubernetesReadClient = {
      readWorkload: async () => ({
        kind: "Deployment",
        metadata: { uid: "app", name: "app", namespace: "shop", generation: 1 },
        spec: { replicas: 1 },
        status: { observedGeneration: 1, updatedReplicas: 1, availableReplicas: 1 }
      }),
      listReplicaSets: async () => ({ items: [] }),
      listEvents: async () => ({ items: [] }),
      listPods: async () => ({
        items: [
          {
            metadata: { name: "app-pod", ownerReferences: [{ uid: "app", controller: true }] },
            status: {
              conditions: [{ type: "Ready", status: "True" }],
              containerStatuses: [
                { name: "sidecar", imageID: `repo@sha256:${"a".repeat(64)}` },
                { name: "checkout", imageID: `repo@sha256:${"b".repeat(64)}` }
              ]
            }
          }
        ]
      })
    };
    const session = createPolicyProviderSession({
      policy: policy({ container_env: "APP_CONTAINER" }),
      workspaceRoot: process.cwd(),
      environment: { APP_CONTAINER: "checkout" },
      runtimeClients: { kubernetes: client },
      clock: () => time
    });
    const result = await session.resolveEvidence?.(
      "kubernetes.image_identity",
      {},
      context("post_deployment")
    );
    expect(result?.[0]?.value).toMatchObject({
      pods: [{ imageDigest: `sha256:${"b".repeat(64)}` }]
    });
  });
});
