import type { ComputeManagementClient } from "@azure/arm-compute";
import { stableFingerprint, type Evidence } from "@observability-gate/core";
import type { RuntimeSnapshot } from "../types.js";
import { asRecord, invalidAzureEvidence, mapAzureError, requireNotCancelled } from "./normalize.js";

export interface AzureVmReadClient {
  getInstanceView(resourceGroup: string, vmName: string, signal: AbortSignal): Promise<unknown>;
}

export class AzureSdkVmReadClient implements AzureVmReadClient {
  public constructor(private readonly client: ComputeManagementClient) {}

  public getInstanceView(
    resourceGroup: string,
    vmName: string,
    signal: AbortSignal
  ): Promise<unknown> {
    return this.client.virtualMachines.instanceView(resourceGroup, vmName, { abortSignal: signal });
  }
}

export interface AzureVmSnapshot extends RuntimeSnapshot {
  readonly vmName: string;
  readonly provisioningState?: string;
  readonly powerState?: string;
  readonly maintenanceState?: string;
}

export interface AzureVmSnapshotRequest {
  readonly target: string;
  readonly resourceGroup: string;
  readonly vmName: string;
  readonly signal: AbortSignal;
}

export class AzureVmRuntimeAdapter {
  public constructor(
    private readonly client: AzureVmReadClient,
    private readonly clock: () => number = Date.now
  ) {}

  public async getSnapshot(request: AzureVmSnapshotRequest): Promise<Evidence<AzureVmSnapshot>> {
    requireNotCancelled(request.signal, "VM");
    try {
      const view = asRecord(
        await this.client.getInstanceView(request.resourceGroup, request.vmName, request.signal)
      );
      requireNotCancelled(request.signal, "VM");
      if (view === undefined || !Array.isArray(view.statuses)) {
        return invalidAzureEvidence("Azure VM instance view is malformed");
      }
      const states: Record<string, string> = {};
      for (const raw of view.statuses) {
        const status = asRecord(raw);
        if (typeof status?.code !== "string" || !status.code.includes("/")) {
          return invalidAzureEvidence("Azure VM instance status code is malformed");
        }
        const [category, state] = status.code.split("/", 2);
        if (category !== undefined && state !== undefined) states[category] = state;
      }
      if (Object.keys(states).length === 0) {
        return invalidAzureEvidence("Azure VM instance view contains no status codes");
      }
      const acquiredAt = new Date(this.clock()).toISOString();
      const value: AzureVmSnapshot = Object.freeze({
        target: request.target,
        runtimeType: "azure_vm",
        observedAt: acquiredAt,
        releaseIdentities: Object.freeze([]),
        conditions: Object.freeze([]),
        events: Object.freeze([]),
        vmName: request.vmName,
        ...(states.ProvisioningState === undefined
          ? {}
          : { provisioningState: states.ProvisioningState }),
        ...(states.PowerState === undefined ? {} : { powerState: states.PowerState }),
        ...(states.MaintenanceState === undefined
          ? {}
          : { maintenanceState: states.MaintenanceState })
      });
      return Object.freeze({
        id: stableFingerprint({ target: request.target, vm: request.vmName, acquiredAt }),
        kind: "runtime.azure-vm.snapshot",
        state: "valid",
        source: Object.freeze({ provider: "azure", capability: "virtual-machine.instance-view" }),
        target: request.target,
        acquiredAt,
        observedAt: acquiredAt,
        value,
        diagnostics: Object.freeze([])
      });
    } catch (error) {
      throw mapAzureError(error, "VM instance view");
    }
  }
}
