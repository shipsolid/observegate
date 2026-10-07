import {
  AzureContainerAppsAdapter,
  AzureVmRuntimeAdapter,
  buildAzureRuntimeClients
} from "@observability-gate/providers";
import { describe, expect, it } from "vitest";

const enabled = process.env.OBSERVEGATE_AZURE_LIVE === "1";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

describe.skipIf(!enabled)("Azure read-only live compatibility", () => {
  it("reads the protected test resource without invoking mutation APIs", async () => {
    const runtimeType = required("AZURE_RUNTIME_TYPE");
    const clients = buildAzureRuntimeClients({
      runtimeType,
      subscriptionId: required("AZURE_SUBSCRIPTION_ID")
    });
    if (clients === undefined) throw new Error("AZURE_RUNTIME_TYPE must select an Azure adapter");
    const signal = new AbortController().signal;

    if (runtimeType === "azure_container_apps") {
      const evidence = await new AzureContainerAppsAdapter(clients.containerAppsRead).getSnapshot({
        target: "azure-read-only-e2e",
        resourceGroup: required("AZURE_RESOURCE_GROUP"),
        appName: required("AZURE_CONTAINER_APP"),
        revisionName: required("AZURE_CONTAINER_APP_REVISION"),
        signal
      });
      expect(evidence.state).toBe("valid");
      return;
    }

    const evidence = await new AzureVmRuntimeAdapter(clients.vmRead).getSnapshot({
      target: "azure-read-only-e2e",
      resourceGroup: required("AZURE_RESOURCE_GROUP"),
      vmName: required("AZURE_VM_NAME"),
      signal
    });
    expect(evidence.state).toBe("valid");
  }, 60_000);
});
