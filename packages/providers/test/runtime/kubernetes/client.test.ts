import { AppsV1Api, CoreV1Api, KubeConfig } from "@kubernetes/client-node";
import { describe, expect, it } from "vitest";
import { buildKubernetesReadClient } from "../../../src/runtime/kubernetes/client.js";

describe("Kubernetes SDK cancellation binding", () => {
  it.each(["Deployment", "StatefulSet", "DaemonSet", "replicaSets", "pods", "events"] as const)(
    "passes cancellation into the SDK HTTP context for %s",
    async (kind) => {
      const controller = new AbortController();
      let bound: AbortSignal | undefined;
      const invoke = async (
        _params: unknown,
        options: Parameters<AppsV1Api["readNamespacedDeployment"]>[1]
      ) => {
        const context = {
          setSignal: (signal: AbortSignal) => {
            bound = signal;
          }
        };
        const middleware = options?.middleware?.[0];
        if (middleware === undefined) throw new Error("SDK cancellation middleware is missing");
        await middleware.pre(context as never).toPromise();
        return { items: [] };
      };
      const apps = {
        readNamespacedDeployment: invoke,
        readNamespacedStatefulSet: invoke,
        readNamespacedDaemonSet: invoke,
        listNamespacedReplicaSet: invoke
      };
      const core = { listNamespacedPod: invoke, listNamespacedEvent: invoke };
      const kubeConfig = {
        makeApiClient: (type: unknown) =>
          type === AppsV1Api ? apps : type === CoreV1Api ? core : undefined
      } as unknown as KubeConfig;
      const client = buildKubernetesReadClient({ kubeConfig });
      if (kind === "replicaSets")
        await client.listReplicaSets({ namespace: "shop", limit: 100, signal: controller.signal });
      else if (kind === "pods")
        await client.listPods({ namespace: "shop", limit: 100, signal: controller.signal });
      else if (kind === "events")
        await client.listEvents({ namespace: "shop", limit: 100, signal: controller.signal });
      else
        await client.readWorkload({
          namespace: "shop",
          name: "checkout",
          kind,
          signal: controller.signal
        });
      expect(bound).toBe(controller.signal);
    }
  );
});
