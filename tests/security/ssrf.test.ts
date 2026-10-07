import { GuardedTransport, UrlPolicy, type FetchLike } from "@observability-gate/providers";
import { describe, expect, it, vi } from "vitest";

function policy(
  resolve: (hostname: string) => Promise<readonly string[]> = async () => ["93.184.216.34"]
) {
  return new UrlPolicy({
    providerOrigins: ["https://api.example.com", "https://127.0.0.1"],
    probeHosts: ["probe.example.com"],
    resolve
  });
}

describe("SSRF boundary", () => {
  it.each([
    "https://127.1/data",
    "https://2130706433/data",
    "https://0x7f000001/data",
    "https://[::1]/data",
    "https://[::ffff:127.0.0.1]/data",
    "https://169.254.169.254/latest/meta-data"
  ])("rejects alternate local or metadata address %s", async (url) => {
    await expect(policy().validate(url, "provider")).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
  });

  it("validates DNS on every attempt and rejects a rebinding answer", async () => {
    const resolve = vi
      .fn<(hostname: string) => Promise<readonly string[]>>()
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["10.0.0.8"]);
    const selected = policy(resolve);

    await expect(
      selected.validate("https://api.example.com/data", "provider")
    ).resolves.toBeInstanceOf(URL);
    await expect(
      selected.validate("https://api.example.com/data", "provider")
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("blocks a redirect to the cloud metadata service before following it", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" }
        })
    ) as FetchLike;
    const transport = new GuardedTransport({ urlPolicy: policy(), fetch });

    await expect(
      transport.request({
        url: "https://api.example.com/data",
        kind: "provider",
        timeoutMs: 100,
        maximumResponseBytes: 1024,
        retry: { attempts: 1, initialBackoffMs: 1, maximumBackoffMs: 1, retryStatuses: [] },
        signal: new AbortController().signal
      })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
