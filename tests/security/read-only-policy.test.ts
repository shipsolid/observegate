import { describe, expect, it } from "vitest";
import { inspectReadOnlySource } from "../../scripts/read-only-policy.js";

const root = process.cwd();

describe("read-only production policy", () => {
  it("rejects Kubernetes mutations across resource kinds, aliases, and element access", () => {
    const violations = inspectReadOnlySource(
      root,
      `
        import type { CoreV1Api, BatchV1Api } from "@kubernetes/client-node";
        declare const core: CoreV1Api;
        declare const batch: BatchV1Api;
        core.createNamespacedConfigMap({ namespace: "default", body: {} });
        batch["deleteNamespacedJob"]({ name: "job", namespace: "default" });
        const mutate = core.replaceNamespacedSecret;
        mutate({ name: "secret", namespace: "default", body: {} });
      `
    );
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("createNamespacedConfigMap"),
        expect.stringContaining("deleteNamespacedJob"),
        expect.stringContaining("replaceNamespacedSecret")
      ])
    );
  });

  it("rejects Azure mutations and computed SDK method access", () => {
    const violations = inspectReadOnlySource(
      root,
      `
        import type { ComputeManagementClient } from "@azure/arm-compute";
        declare const client: ComputeManagementClient;
        client.virtualMachines.beginUpdateAndWait("group", "vm", {});
        const { beginDelete: remove } = client.virtualMachines;
        remove("group", "vm");
        declare const method: string;
        client.virtualMachines[method]("group", "vm");
      `
    );
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("beginUpdateAndWait"),
        expect.stringContaining("beginDelete"),
        expect.stringContaining("<computed>")
      ])
    );
  });

  it("rejects computed module loading and allows typed read calls", () => {
    const violations = inspectReadOnlySource(
      root,
      `
        import type { CoreV1Api } from "@kubernetes/client-node";
        declare const core: CoreV1Api;
        core.listNamespacedPod({ namespace: "default" });
        declare const moduleName: string;
        require(moduleName);
        import(moduleName);
      `
    );
    expect(violations).toEqual([
      expect.stringContaining("runtime require"),
      expect.stringContaining("dynamic import")
    ]);
  });
});
