import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: captured.request }));
import { GuardedTransport } from "../../src/transport/guarded-fetch.js";
import { UrlPolicy } from "../../src/transport/url-policy.js";

describe("native HTTPS DNS pinning", () => {
  it("uses only validated addresses while preserving hostname and certificate verification", async () => {
    const connected: unknown[] = [];
    captured.request.mockImplementation((url, options, callback) => {
      expect(url.hostname).toBe("api.example.com");
      expect(options.agent).toBe(false);
      expect(options.rejectUnauthorized).not.toBe(false);
      expect(options.checkServerIdentity).toBeUndefined();
      options.lookup("api.example.com", { all: true }, (error: unknown, answers: unknown) => {
        expect(error).toBeNull();
        connected.push(answers);
      });
      const outgoing = new EventEmitter() as EventEmitter & { end: () => void };
      outgoing.end = () =>
        queueMicrotask(() =>
          callback(
            Object.assign(Readable.from([Buffer.from('{"ok":true}')]), {
              statusCode: 200,
              headers: {}
            })
          )
        );
      return outgoing;
    });
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(["93.184.216.34", "2606:4700:4700::1111"])
      .mockResolvedValue(["127.0.0.1"]);
    const transport = new GuardedTransport({
      urlPolicy: new UrlPolicy({
        providerOrigins: ["https://api.example.com"],
        probeHosts: [],
        resolve
      })
    });
    await expect(
      transport.request({
        url: "https://api.example.com/data",
        kind: "provider",
        timeoutMs: 100,
        maximumResponseBytes: 1024,
        retry: { attempts: 1, initialBackoffMs: 0, maximumBackoffMs: 0, retryStatuses: [] },
        signal: new AbortController().signal
      })
    ).resolves.toMatchObject({ data: { ok: true } });
    expect(connected).toEqual([
      [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 }
      ]
    ]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
