import { describe, expect, it } from "vitest";
import { inspectReadOnlySource } from "../../scripts/read-only-policy.js";

const root = process.cwd();

describe("read-only production policy", () => {
  it("rejects mutation variants and computed execution while allowing typed reads", () => {
    const violations = inspectReadOnlySource(
      root,
      `
          import type { CoreV1Api, BatchV1Api } from "@kubernetes/client-node";
          import type { ComputeManagementClient } from "@azure/arm-compute";
          declare const core: CoreV1Api;
          declare const batch: BatchV1Api;
          declare const client: ComputeManagementClient;
          declare const method: string;
          declare const moduleName: string;

          core.listNamespacedPod({ namespace: "default" });
          core.createNamespacedConfigMap({ namespace: "default", body: {} });
          batch["deleteNamespacedJob"]({ name: "job", namespace: "default" });
          const mutate = core.replaceNamespacedSecret;
          mutate({ name: "secret", namespace: "default", body: {} });
          client.virtualMachines.beginUpdateAndWait("group", "vm", {});
          const { beginDelete: remove } = client.virtualMachines;
          remove("group", "vm");
          client.virtualMachines[method]("group", "vm");
          require(moduleName);
          import(moduleName);
        `
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("createNamespacedConfigMap"),
        expect.stringContaining("deleteNamespacedJob"),
        expect.stringContaining("replaceNamespacedSecret"),
        expect.stringContaining("beginUpdateAndWait"),
        expect.stringContaining("beginDelete"),
        expect.stringContaining("<computed>"),
        expect.stringContaining("runtime require"),
        expect.stringContaining("dynamic import")
      ])
    );
    expect(violations).not.toContainEqual(expect.stringContaining("listNamespacedPod"));
  }, 15_000);
});
