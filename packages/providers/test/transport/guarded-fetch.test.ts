import { describe, expect, it, vi } from "vitest";
import { GuardedTransport, UrlPolicy, type FetchLike, type UrlKind } from "../../src/index.js";

function policy(resolvedAddresses: readonly string[] = ["93.184.216.34"]): UrlPolicy {
  return new UrlPolicy({
    providerOrigins: ["https://api.example.com"],
    probeHosts: ["probe.example.com"],
    allowedPorts: [443],
    resolve: async () => resolvedAddresses
  });
}

describe("UrlPolicy", () => {
  it.each([
    "http://api.example.com/path",
    "https://user:password@api.example.com/path",
    "https://127.0.0.1/path",
    "https://[::1]/path",
    "https://10.0.0.1/path",
    "https://172.16.0.1/path",
    "https://192.168.1.1/path",
    "https://169.254.20.10/path",
    "https://169.254.169.254/latest/meta-data",
    "https://api.example.com:8443/path"
  ])("rejects forbidden URL %s", async (url) => {
    await expect(policy().validate(url, "provider")).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
  });

  it("rejects configured hosts whose DNS answer is private", async () => {
    await expect(
      policy(["10.1.2.3"]).validate("https://api.example.com/path", "provider")
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });

  it.each([
    ["https://api.example.com/path", "provider"],
    ["https://probe.example.com/ready", "probe"]
  ] as const)("accepts allowlisted HTTPS URL %s", async (url, kind) => {
    await expect(policy().validate(url, kind)).resolves.toEqual(new URL(url));
  });

  it("rejects hosts outside the selected allowlist", async () => {
    await expect(
      policy().validate("https://other.example.com/path", "provider")
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
  });
});

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

function fetchSequence(entries: readonly (Response | Error)[]): {
  fetch: FetchLike;
  calls: ReturnType<typeof vi.fn>;
} {
  const calls = vi.fn(async () => {
    const entry = entries[calls.mock.calls.length - 1];
    if (entry instanceof Error) {
      throw entry;
    }
    if (entry === undefined) {
      throw new Error("No fake response configured");
    }
    return entry;
  });
  return { fetch: calls as FetchLike, calls };
}

function request(
  transport: GuardedTransport,
  overrides: Partial<Parameters<GuardedTransport["request"]>[0]> = {}
) {
  return transport.request({
    url: "https://api.example.com/data",
    kind: "provider" as UrlKind,
    timeoutMs: 100,
    maximumResponseBytes: 1024,
    retry: {
      attempts: 3,
      initialBackoffMs: 10,
      maximumBackoffMs: 100,
      retryStatuses: [429, 502, 503, 504]
    },
    signal: new AbortController().signal,
    ...overrides
  });
}

describe("GuardedTransport", () => {
  it("parses bounded JSON responses", async () => {
    const fake = fetchSequence([jsonResponse({ status: "ready" })]);
    const transport = new GuardedTransport({ urlPolicy: policy(), fetch: fake.fetch });

    await expect(request(transport)).resolves.toMatchObject({
      status: 200,
      data: { status: "ready" },
      attempts: 1
    });
  });

  it("decodes multibyte JSON characters split across response chunks", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ status: "ready ☃" }));
    const split = bytes.indexOf(0xe2) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      }
    });
    const transport = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fetchSequence([new Response(body, { status: 200 })]).fetch
    });

    await expect(request(transport)).resolves.toMatchObject({
      data: { status: "ready ☃" }
    });
  });

  it("rejects malformed UTF-8 response chunks", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3]));
        controller.enqueue(Uint8Array.from([0x28, 0x22, 0x7d]));
        controller.close();
      }
    });
    const transport = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fetchSequence([new Response(body, { status: 200 })]).fetch
    });

    await expect(request(transport)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });
  });

  it("honors Retry-After for 429 and retries 502, 503, and 504", async () => {
    const responses = [
      new Response("busy", { status: 429, headers: { "retry-after": "0" } }),
      new Response("bad gateway", { status: 502 }),
      new Response("unavailable", { status: 503 }),
      new Response("timeout", { status: 504 }),
      jsonResponse({ ok: true })
    ];
    const fake = fetchSequence(responses);
    const delays: number[] = [];
    const transport = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fake.fetch,
      sleep: async (delay) => {
        delays.push(delay);
      },
      random: () => 0.5
    });

    await expect(
      request(transport, {
        retry: {
          attempts: 5,
          initialBackoffMs: 10,
          maximumBackoffMs: 100,
          retryStatuses: [429, 502, 503, 504]
        }
      })
    ).resolves.toMatchObject({ attempts: 5, data: { ok: true } });
    expect(delays).toEqual([0, 20, 40, 80]);
  });

  it.each([400, 401, 403])("does not retry HTTP %s", async (status) => {
    const fake = fetchSequence([new Response("denied", { status })]);
    const transport = new GuardedTransport({ urlPolicy: policy(), fetch: fake.fetch });

    await expect(request(transport)).rejects.toMatchObject({ retryable: false });
    expect(fake.calls).toHaveBeenCalledTimes(1);
  });

  it("retries a connection reset", async () => {
    const reset = Object.assign(new Error("reset"), { code: "ECONNRESET" });
    const fake = fetchSequence([reset, jsonResponse({ ok: true })]);
    const transport = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fake.fetch,
      sleep: async () => undefined
    });

    await expect(request(transport)).resolves.toMatchObject({ attempts: 2 });
  });

  it("rejects malformed JSON and oversized HTTP 200 bodies", async () => {
    const malformed = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fetchSequence([
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      ]).fetch
    });
    await expect(request(malformed)).rejects.toMatchObject({ code: "PROVIDER_PROTOCOL" });

    const oversized = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fetchSequence([jsonResponse({ value: "too-large" })]).fetch
    });
    await expect(request(oversized, { maximumResponseBytes: 5 })).rejects.toMatchObject({
      code: "PROVIDER_PROTOCOL"
    });
  });

  it("stops after the maximum attempt count", async () => {
    const fake = fetchSequence([
      new Response("no", { status: 503 }),
      new Response("no", { status: 503 }),
      new Response("no", { status: 503 })
    ]);
    const transport = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fake.fetch,
      sleep: async () => undefined
    });

    await expect(request(transport)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(fake.calls).toHaveBeenCalledTimes(3);
  });

  it("truncates retries at the phase deadline", async () => {
    const fake = fetchSequence([new Response("no", { status: 503 })]);
    const transport = new GuardedTransport({
      urlPolicy: policy(),
      fetch: fake.fetch,
      clock: () => 1000,
      random: () => 0.5
    });

    await expect(request(transport, { deadlineAtMs: 1005 })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE"
    });
    expect(fake.calls).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin redirects before forwarding authorization", async () => {
    const fake = fetchSequence([
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example.com/data" }
      })
    ]);
    const transport = new GuardedTransport({ urlPolicy: policy(), fetch: fake.fetch });

    await expect(
      request(transport, { headers: { authorization: "Bearer secret" } })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    expect(fake.calls).toHaveBeenCalledTimes(1);
  });

  it("stops promptly on timeout and cancellation", async () => {
    const hangingFetch: FetchLike = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true
        });
      });
    const transport = new GuardedTransport({ urlPolicy: policy(), fetch: hangingFetch });

    await expect(request(transport, { timeoutMs: 5 })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE"
    });

    const controller = new AbortController();
    controller.abort();
    await expect(request(transport, { signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED"
    });
  });
});
