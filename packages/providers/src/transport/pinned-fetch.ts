import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

// Keep the URL hostname for Host, SNI and certificate verification; only socket lookup is pinned.
export async function pinnedFetch(
  url: URL,
  init: RequestInit,
  addresses: readonly string[]
): Promise<Response> {
  const outbound = new Request(url, init);
  const body =
    init.body === undefined || init.body === null
      ? undefined
      : Buffer.from(await outbound.arrayBuffer());
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: outbound.method,
        headers: Object.fromEntries(outbound.headers),
        agent: false,
        ...(init.signal === null || init.signal === undefined ? {} : { signal: init.signal }),
        lookup: (_hostname, options, callback) => {
          const answers = addresses.map((address) => ({ address, family: isIP(address) }));
          if (options.all) callback(null, answers);
          else {
            const first = answers[0];
            if (first === undefined) callback(new Error("No validated connection address"), "", 0);
            else callback(null, first.address, first.family);
          }
        }
      },
      (incoming) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
          else if (value !== undefined) headers.set(name, value);
        }
        const status = incoming.statusCode ?? 500;
        const noBody = outbound.method === "HEAD" || [204, 205, 304].includes(status);
        if (noBody) incoming.resume();
        resolve(
          new Response(
            noBody ? null : (Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>),
            { status, headers }
          )
        );
      }
    );
    request.on("error", reject);
    request.end(body);
  });
}
