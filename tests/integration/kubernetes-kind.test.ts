import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAllDocuments } from "yaml";
import { EvidenceStore } from "@observability-gate/core";
import { GateCatalog, registerKubernetesGates } from "@observability-gate/gates";
import { promisify } from "node:util";
import { KubernetesRuntimeAdapter, buildKubernetesReadClient } from "@observability-gate/providers";
import { afterAll, describe, expect, it } from "vitest";

const enabled = process.env.OBSERVEGATE_KIND === "1";
const exec = promisify(execFile);
let portForward: ChildProcess | undefined;

afterAll(() => portForward?.kill("SIGTERM"));

describe.skipIf(!enabled)("kind runtime integration", () => {
  it("observes a healthy rollout and then a failing image without mutating from product code", async () => {
    await exec("kubectl", ["create", "namespace", "observegate-e2e"], { timeout: 30_000 }).catch(
      () => undefined
    );
    await exec("kubectl", ["apply", "-f", "docker/e2e-service/kubernetes.yml"], {
      timeout: 30_000
    });
    await exec(
      "kubectl",
      ["-n", "observegate-e2e", "rollout", "status", "deployment/observegate-e2e", "--timeout=90s"],
      { timeout: 100_000 }
    );

    const adapter = new KubernetesRuntimeAdapter(buildKubernetesReadClient());
    const healthy = await adapter.getSnapshot({
      target: "kind-checkout",
      namespace: "observegate-e2e",
      kind: "Deployment",
      name: "observegate-e2e",
      deploymentStartedAt: new Date(Date.now() - 60_000).toISOString(),
      signal: new AbortController().signal
    });
    expect(healthy.value?.rollout.generationObserved).toBe(true);
    expect(healthy.value?.rollout.replicas.available).toBe(1);

    portForward = spawn("kubectl", [
      "-n",
      "observegate-e2e",
      "port-forward",
      "service/observegate-e2e",
      "18080:8080"
    ]);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await expect(fetch("http://127.0.0.1:18080/checkout")).resolves.toMatchObject({ status: 200 });

    await exec("kubectl", [
      "-n",
      "observegate-e2e",
      "set",
      "image",
      "deployment/observegate-e2e",
      "checkout=observegate/does-not-exist:failure"
    ]);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const failing = await adapter.getSnapshot({
      target: "kind-checkout",
      namespace: "observegate-e2e",
      kind: "Deployment",
      name: "observegate-e2e",
      deploymentStartedAt: new Date(Date.now() - 60_000).toISOString(),
      signal: new AbortController().signal
    });
    expect(failing.value?.rollout.replicas.unavailable).toBeGreaterThan(0);
    expect(
      failing.value?.pods.some(
        (pod) =>
          pod.waitingReasons.includes("ErrImagePull") ||
          pod.waitingReasons.includes("ImagePullBackOff")
      )
    ).toBe(true);
  }, 140_000);
  it.each(["StatefulSet", "DaemonSet"] as const)(
    "observes healthy multi-container %s through rollout evaluation",
    async (kind) => {
      const root = await mkdtemp(join(tmpdir(), "observegate-kind-"));
      try {
        const source = await readFile("docker/e2e-service/kubernetes.yml", "utf8");
        const base = parseAllDocuments(source)[0]?.toJS() as {
          metadata: Record<string, string>;
          spec: {
            template: {
              metadata: { labels: Record<string, string> };
              spec: { containers: Record<string, unknown>[] };
            };
            selector: unknown;
          };
        };
        const name = `observegate-${kind.toLowerCase()}`;
        base.metadata.name = name;
        base.spec.template.metadata.labels = { app: name };
        base.spec.template.spec.containers.unshift({
          name: "sidecar",
          image: "observegate/e2e-service:local",
          imagePullPolicy: "Never",
          command: ["node", "-e", "setInterval(() => {}, 1000)"]
        });
        const workload = {
          apiVersion: "apps/v1",
          kind,
          metadata: base.metadata,
          spec: {
            selector: { matchLabels: { app: name } },
            template: base.spec.template,
            updateStrategy: { type: "RollingUpdate" },
            ...(kind === "StatefulSet" ? { serviceName: "observegate-e2e", replicas: 1 } : {})
          }
        };
        const path = join(root, "workload.json");
        await writeFile(path, JSON.stringify(workload));
        await exec("kubectl", ["apply", "-f", path], { timeout: 30_000 });
        await exec(
          "kubectl",
          [
            "-n",
            "observegate-e2e",
            "rollout",
            "status",
            `${kind.toLowerCase()}/${name}`,
            "--timeout=90s"
          ],
          { timeout: 100_000 }
        );
        const adapter = new KubernetesRuntimeAdapter(buildKubernetesReadClient());
        const result = await adapter.getSnapshot({
          target: name,
          namespace: "observegate-e2e",
          kind,
          name,
          container: "checkout",
          deploymentStartedAt: new Date(Date.now() - 60_000).toISOString(),
          signal: new AbortController().signal
        });
        expect(result.value?.workloadKind).toBe(kind);
        expect(result.value?.pods.length).toBeGreaterThan(0);
        expect(result.value?.pods.every((pod) => pod.imageDigest !== undefined)).toBe(true);
        const gate = registerKubernetesGates(new GateCatalog()).require(
          "kubernetes.rollout_status",
          "post_deployment",
          {}
        );
        const assertions = gate.evaluate(
          [
            {
              ...result,
              value: {
                ...result.value,
                rollout: {
                  ...result.value?.rollout,
                  durationMs: 60_000,
                  maximumDurationMs: 120_000
                }
              }
            }
          ],
          {
            phase: "post_deployment",
            targetId: name,
            evidenceStore: new EvidenceStore(),
            signal: new AbortController().signal,
            clock: () => new Date(),
            missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
          }
        );
        expect(
          assertions.every((item) => item.status === "passed"),
          JSON.stringify(assertions)
        ).toBe(true);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
    140_000
  );
});
