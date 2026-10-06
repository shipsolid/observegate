import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";

export type FakeHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => void | Promise<void>;

export class FakeHttpServer {
  private readonly server: Server;

  public constructor(handler: FakeHttpHandler) {
    this.server = createServer((request, response) => {
      void Promise.resolve(handler(request, response)).catch((error: unknown) => {
        response.statusCode = 500;
        response.end(error instanceof Error ? error.message : "fake server failure");
      });
    });
  }

  public async listen(): Promise<URL> {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fake HTTP server did not bind to a TCP port");
    }
    return new URL(`http://127.0.0.1:${address.port}`);
  }

  public async close(): Promise<void> {
    this.server.close();
    await once(this.server, "close");
  }
}
