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
});
