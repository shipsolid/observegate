import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeKubernetesSnapshot, parseKubernetesManifest } from "../../../src/index.js";

async function json(name: string): Promise<unknown> {
  const url = new URL(`../../../../../fixtures/providers/kubernetes/${name}.json`, import.meta.url);
  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as unknown;
}

describe("normalizeKubernetesSnapshot", () => {
  it.each([
    ["deployment", { desired: 3, updated: 3, ready: 2, available: 2, unavailable: 1 }],
    ["statefulset", { desired: 2, updated: 1, ready: 1, available: 1, unavailable: 1 }],
    ["daemonset", { desired: 4, updated: 4, ready: 3, available: 3, unavailable: 1 }]
  ] as const)("normalizes %s replica and observed-generation status", async (name, replicas) => {
    const result = normalizeKubernetesSnapshot({
      workload: await json(name),
      replicaSets: [],
      pods: [],
      events: [],
      observedAt: "2026-10-06T08:00:00.000Z"
    });
    expect(result.rollout).toMatchObject({ generationObserved: true, replicas });
  });

  it("preserves owner selection, pod readiness, digests, restarts, reasons, OOM, and warnings", async () => {
    const workload = await json("deployment");
    const pods = ((await json("pods")) as { items: unknown[] }).items;
    const events = ((await json("events")) as { items: unknown[] }).items;
    const result = normalizeKubernetesSnapshot({
      workload,
      replicaSets: [
        { metadata: { uid: "other", ownerReferences: [{ uid: "other-owner", controller: true }] } },
        { metadata: { uid: "rs-uid", ownerReferences: [{ uid: "deploy-uid", controller: true }] } }
      ],
      pods,
      events,
      observedAt: "2026-10-06T08:00:00.000Z"
    });
    expect(result.replicaSetUids).toEqual(["rs-uid"]);
    expect(result.pods).toEqual([
      expect.objectContaining({
        name: "checkout-abc",
        ready: false,
        restarts: 2,
        imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        waitingReasons: ["CrashLoopBackOff"],
        terminationReasons: ["OOMKilled"],
        oomKilled: true
      })
    ]);
    expect(result.warningEvents).toEqual([
      expect.objectContaining({ reason: "BackOff", involvedObject: "checkout-abc" })
    ]);
    expect(result.rollout.conditions).toEqual([
      { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" },
      { type: "Available", status: "False", reason: "MinimumReplicasUnavailable" }
    ]);
  });
});

describe("parseKubernetesManifest", () => {
  it("extracts workload, security, probes, resources, strategy, and disruption budget", async () => {
    const content = await readFile(
      fileURLToPath(
        new URL("../../../../../fixtures/manifests/kubernetes/workload.yml", import.meta.url)
      ),
      "utf8"
    );
    expect(
      parseKubernetesManifest(content, { kind: "Deployment", name: "checkout", namespace: "shop" })
    ).toMatchObject({
      image:
        "ghcr.io/shipsolid/checkout@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      replicas: 3,
      strategy: "RollingUpdate",
      progressDeadlineSeconds: 600,
      minimumReadySeconds: 10,
      podSecurityContext: { runAsNonRoot: true },
      containerSecurityContext: { allowPrivilegeEscalation: false },
      readinessProbe: { httpGet: { path: "/ready", port: 8080 } },
      livenessProbe: { httpGet: { path: "/health", port: 8080 } },
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "512Mi" }
      },
      disruptionBudget: { minAvailable: 2 }
    });
  });
});
