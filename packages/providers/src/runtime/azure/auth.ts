import { ContainerAppsAPIClient } from "@azure/arm-appcontainers";
import { ComputeManagementClient } from "@azure/arm-compute";
import { DefaultAzureCredential } from "@azure/identity";
import { GateError } from "@observability-gate/core";
import { AzureSdkContainerAppsReadClient } from "./container-apps.js";
import { AzureSdkVmReadClient } from "./virtual-machines.js";

export type AzureRuntimeType = "azure_container_apps" | "azure_vm";

export interface AzureCredentialLike {
  getToken(scopes: string | readonly string[], options?: unknown): Promise<unknown>;
}

export interface AzureRuntimeClientOptions {
  readonly runtimeType: string;
  readonly subscriptionId?: string;
  readonly credentialFactory?: () => AzureCredentialLike;
}

export function buildAzureRuntimeClients(options: AzureRuntimeClientOptions):
  | {
      readonly containerAppsRead: AzureSdkContainerAppsReadClient;
      readonly vmRead: AzureSdkVmReadClient;
    }
  | undefined {
  if (options.runtimeType !== "azure_container_apps" && options.runtimeType !== "azure_vm") {
    return undefined;
  }
  if (options.subscriptionId === undefined || options.subscriptionId.length === 0) {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: "Azure targets require a subscription identifier",
      retryable: false
    });
  }
  const credential = options.credentialFactory?.() ?? new DefaultAzureCredential();
  const containerApps = new ContainerAppsAPIClient(
    credential as ConstructorParameters<typeof ContainerAppsAPIClient>[0],
    options.subscriptionId
  );
  const compute = new ComputeManagementClient(
    credential as ConstructorParameters<typeof ComputeManagementClient>[0],
    options.subscriptionId
  );
  return {
    containerAppsRead: new AzureSdkContainerAppsReadClient(containerApps),
    vmRead: new AzureSdkVmReadClient(compute)
  };
}
