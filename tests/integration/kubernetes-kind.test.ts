import { execFile, spawn, type ChildProcess } from "node:child_process";
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
});
