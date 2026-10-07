import { describe, expect, it, vi } from "vitest";
import { buildAzureRuntimeClients } from "../../../src/index.js";

describe("buildAzureRuntimeClients", () => {
  it("constructs credentials only for Azure targets", () => {
    const credentialFactory = vi.fn(() => ({ getToken: vi.fn() }));
    expect(
      buildAzureRuntimeClients({ runtimeType: "kubernetes", credentialFactory })
    ).toBeUndefined();
    expect(credentialFactory).not.toHaveBeenCalled();

    expect(() =>
      buildAzureRuntimeClients({ runtimeType: "azure_container_apps", credentialFactory })
    ).toThrowError(expect.objectContaining({ code: "CONFIG_REFERENCE" }));
    expect(credentialFactory).not.toHaveBeenCalled();
  });

  it("exposes only read-only Azure adapters", () => {
    const clients = buildAzureRuntimeClients({
      runtimeType: "azure_container_apps",
      subscriptionId: "subscription-1",
      credentialFactory: () => ({ getToken: vi.fn() })
    });

    expect(Object.keys(clients ?? {}).sort()).toEqual(["containerAppsRead", "vmRead"]);
    expect(clients?.containerAppsRead).toBeDefined();
    expect(clients?.vmRead).toBeDefined();
  });
});
