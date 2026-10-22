import { describe, expect, it, vi } from "vitest";
import { KubernetesRuntimeAdapter, type KubernetesReadClient } from "../../../src/index.js";

function workload() {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "checkout", namespace: "shop", uid: "deploy", generation: 1 },
    spec: { replicas: 1, selector: { matchLabels: { app: "checkout" } } },
    status: {
      observedGeneration: 1,
      replicas: 1,
      updatedReplicas: 1,
      readyReplicas: 1,
      availableReplicas: 1
    }
  };
}

function fakeClient(overrides: Partial<KubernetesReadClient> = {}): KubernetesReadClient {
  return {
    readWorkload: vi.fn(async () => workload()),
    listReplicaSets: vi.fn(async () => ({ items: [], continueToken: undefined })),
    listPods: vi.fn(async () => ({ items: [], continueToken: undefined })),
    listEvents: vi.fn(async () => ({ items: [], continueToken: undefined })),
    ...overrides
  };
}

const request = {
  target: "prod-checkout",
  namespace: "shop",
  kind: "Deployment" as const,
  name: "checkout",
  deploymentStartedAt: "2026-10-06T07:55:00.000Z",
  signal: new AbortController().signal
};

describe("KubernetesRuntimeAdapter", () => {
  it("continues paginated reads and returns one normalized snapshot", async () => {
    const pods = vi
      .fn<KubernetesReadClient["listPods"]>()
      .mockResolvedValueOnce({
        items: [{ metadata: { name: "one" }, status: {} }],
        continueToken: "next"
      })
      .mockResolvedValueOnce({
        items: [{ metadata: { name: "two" }, status: {} }],
        continueToken: undefined
      });
    const adapter = new KubernetesRuntimeAdapter(fakeClient({ listPods: pods }), () =>
      Date.parse("2026-10-06T08:00:00.000Z")
    );
    const evidence = await adapter.getSnapshot(request);
    expect(evidence.state).toBe("valid");
    expect(evidence.value?.pods).toHaveLength(2);
    expect(pods).toHaveBeenNthCalledWith(2, expect.objectContaining({ continueToken: "next" }));
  });

  it("maps forbidden API responses to authorization failures", async () => {
    const failure = Object.assign(new Error("forbidden"), { statusCode: 403 });
    const adapter = new KubernetesRuntimeAdapter(
      fakeClient({ readWorkload: vi.fn(async () => Promise.reject(failure)) })
    );
    await expect(adapter.getSnapshot(request)).rejects.toMatchObject({ code: "AUTHORIZATION" });
  });

  it("stops between pages when cancelled", async () => {
    const controller = new AbortController();
    const pods = vi.fn<KubernetesReadClient["listPods"]>(async () => {
      controller.abort();
      return { items: [], continueToken: "next" };
    });
    const adapter = new KubernetesRuntimeAdapter(fakeClient({ listPods: pods }));
    await expect(
      adapter.getSnapshot({ ...request, signal: controller.signal })
    ).rejects.toMatchObject({
      code: "CANCELLED"
    });
    expect(pods).toHaveBeenCalledTimes(1);
  });
});

describe("Kubernetes cancellation and pagination security", () => {
  it("rejects cancellation on the final response", async () => {
    const controller = new AbortController();
    const adapter = new KubernetesRuntimeAdapter(
      fakeClient({
        listEvents: async () => {
          controller.abort();
          return { items: [] };
        }
      })
    );
    await expect(
      adapter.getSnapshot({ ...request, signal: controller.signal })
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("settles in-flight reads when the client ignores cancellation", async () => {
    const controller = new AbortController();
    const adapter = new KubernetesRuntimeAdapter(
      fakeClient({ readWorkload: async () => new Promise(() => undefined) })
    );
    const pending = adapter.getSnapshot({ ...request, signal: controller.signal });
    setTimeout(() => controller.abort(), 5);
    expect(
      await Promise.race([
        pending.catch((error: unknown) => error),
        new Promise((resolve) => setTimeout(() => resolve({ code: "HUNG" }), 60))
      ])
    ).toMatchObject({ code: "CANCELLED" });
  });

  it("rejects repeated continuation tokens", async () => {
    let pages = 0;
    const adapter = new KubernetesRuntimeAdapter(
      fakeClient({
        listPods: async () => {
          pages++;
          if (pages > 3) throw new Error("unbounded pagination");
          return { items: [], continueToken: "repeat" };
        }
      })
    );
    await expect(adapter.getSnapshot(request)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });
    expect(pages).toBe(2);
  });
});

describe("Kubernetes pagination bounds", () => {
  it("rejects more than 100 pages even with unique tokens", async () => {
    let pages = 0;
    const adapter = new KubernetesRuntimeAdapter(
      fakeClient({ listPods: async () => ({ items: [], continueToken: String(++pages) }) })
    );
    await expect(adapter.getSnapshot(request)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });
    expect(pages).toBe(100);
  });
  it("rejects more than 10000 accumulated items", async () => {
    const adapter = new KubernetesRuntimeAdapter(
      fakeClient({ listPods: async () => ({ items: Array.from({ length: 10001 }, () => ({})) }) })
    );
    await expect(adapter.getSnapshot(request)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });
  });
  it.each(["listReplicaSets", "listPods", "listEvents"] as const)(
    "propagates the signal and cancels an uncooperative %s",
    async (method) => {
      const controller = new AbortController();
      const adapter = new KubernetesRuntimeAdapter(
        fakeClient({
          [method]: async (page) => {
            expect(page.signal).toBe(controller.signal);
            queueMicrotask(() => controller.abort());
            return new Promise(() => undefined);
          }
        })
      );
      await expect(
        adapter.getSnapshot({ ...request, signal: controller.signal })
      ).rejects.toMatchObject({ code: "CANCELLED" });
    }
  );
});
