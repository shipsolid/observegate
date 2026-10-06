import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { AzureVmRuntimeAdapter, type AzureVmReadClient } from "../../../src/index.js";

async function running(): Promise<unknown> {
  return JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../../fixtures/providers/azure/virtual-machines/running.json",
          import.meta.url
        )
      ),
      "utf8"
    )
  ) as unknown;
}

const request = {
  target: "prod-vm",
  resourceGroup: "prod-rg",
  vmName: "checkout-01",
  signal: new AbortController().signal
};

describe("AzureVmRuntimeAdapter", () => {
  it("normalizes provisioning, power, and maintenance state", async () => {
    const client: AzureVmReadClient = { getInstanceView: vi.fn(async () => running()) };
    await expect(new AzureVmRuntimeAdapter(client).getSnapshot(request)).resolves.toMatchObject({
      state: "valid",
      value: {
        provisioningState: "succeeded",
        powerState: "running",
        maintenanceState: "notRequired"
      }
    });
  });

  it.each([
    ["ProvisioningState/failed", "failed"],
    ["PowerState/stopped", "stopped"]
  ])("preserves %s", async (code, expected) => {
    const client: AzureVmReadClient = {
      getInstanceView: vi.fn(async () => ({ statuses: [{ code }] }))
    };
    const value = (await new AzureVmRuntimeAdapter(client).getSnapshot(request)).value;
    expect(value?.provisioningState === expected || value?.powerState === expected).toBe(true);
  });

  it("rejects malformed status codes, maps missing VMs, and honors cancellation", async () => {
    const malformed: AzureVmReadClient = {
      getInstanceView: vi.fn(async () => ({ statuses: [{ code: "bad" }] }))
    };
    await expect(new AzureVmRuntimeAdapter(malformed).getSnapshot(request)).rejects.toMatchObject({
      code: "EVIDENCE_INVALID"
    });

    const missing: AzureVmReadClient = {
      getInstanceView: vi.fn(async () =>
        Promise.reject(Object.assign(new Error("missing"), { statusCode: 404 }))
      )
    };
    await expect(new AzureVmRuntimeAdapter(missing).getSnapshot(request)).rejects.toMatchObject({
      code: "EVIDENCE_INVALID"
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      new AzureVmRuntimeAdapter(malformed).getSnapshot({ ...request, signal: controller.signal })
    ).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
