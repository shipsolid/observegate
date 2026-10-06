import { GateError } from "@observability-gate/core";
import { cancelled, exponentialBackoff, sleepWithCancellation, type RetryPolicy } from "./retry.js";
import { UrlPolicy, type UrlKind } from "./url-policy.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface TransportRequest {
  readonly url: string | URL;
  readonly kind: UrlKind;
  readonly method?: string;
  readonly headers?: HeadersInit;
  readonly body?: BodyInit | null;
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
  readonly retry: RetryPolicy;
  readonly signal: AbortSignal;
  readonly deadlineAtMs?: number;
  readonly responseType?: "json" | "none";
}

export interface TransportResponse<T = unknown> {
  readonly status: number;
  readonly data: T;
  readonly attempts: number;
  readonly headers: Headers;
}

export interface GuardedTransportOptions {
  readonly urlPolicy: UrlPolicy;
  readonly fetch?: FetchLike;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly random?: () => number;
  readonly clock?: () => number;
}

class HttpFailure extends GateError {
  public readonly retryAfterMs: number | undefined;
  public readonly httpStatus: number;

  public constructor(options: {
    code: "AUTHENTICATION" | "AUTHORIZATION" | "PROVIDER_PROTOCOL" | "PROVIDER_UNAVAILABLE";
    safeMessage: string;
    retryable: boolean;
    httpStatus: number;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(options);
    this.retryAfterMs = options.retryAfterMs;
    this.httpStatus = options.httpStatus;
  }
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function retryAfterMilliseconds(value: string | null, now: number): number | undefined {
  if (value === null) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function timeoutError(cause?: unknown): GateError {
  return new GateError({
    code: "PROVIDER_UNAVAILABLE",
    safeMessage: "Provider request timed out",
    retryable: true,
    cause
  });
}

function unavailable(cause: unknown): GateError {
  return new GateError({
    code: "PROVIDER_UNAVAILABLE",
    safeMessage: "Provider request failed",
    retryable: true,
    cause
  });
}

function asGateError(error: unknown, parentSignal: AbortSignal, timedOut: boolean): GateError {
  if (error instanceof GateError) {
    return error;
  }
  if (parentSignal.aborted) {
    return cancelled(parentSignal.reason ?? error);
  }
  if (timedOut) {
    return timeoutError(error);
  }
  return unavailable(error);
}

async function readBoundedJson(response: Response, limit: number): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    await response.body?.cancel();
    throw new GateError({
      code: "PROVIDER_PROTOCOL",
      safeMessage: "Provider response exceeded the configured size limit",
      retryable: false
    });
  }

  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new GateError({
      code: "PROVIDER_PROTOCOL",
      safeMessage: "Provider response did not contain a body",
      retryable: false
    });
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new GateError({
          code: "PROVIDER_PROTOCOL",
          safeMessage: "Provider response exceeded the configured size limit",
          retryable: false
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch (cause) {
    throw new GateError({
      code: "PROVIDER_PROTOCOL",
      safeMessage: "Provider returned malformed JSON",
      retryable: false,
      cause
    });
  }
}

export class GuardedTransport {
  private readonly urlPolicy: UrlPolicy;
  private readonly fetchImplementation: FetchLike;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly random: () => number;
  private readonly clock: () => number;

  public constructor(options: GuardedTransportOptions) {
    this.urlPolicy = options.urlPolicy;
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? Date.now;
  }

  public async request<T = unknown>(request: TransportRequest): Promise<TransportResponse<T>> {
    if (request.signal.aborted) {
      throw cancelled(request.signal.reason);
    }
    if (!Number.isInteger(request.retry.attempts) || request.retry.attempts < 1) {
      throw new GateError({
        code: "INTERNAL",
        safeMessage: "Retry attempts must be a positive integer",
        retryable: false
      });
    }

    let lastError: GateError | undefined;
    for (let attempt = 1; attempt <= request.retry.attempts; attempt += 1) {
      try {
        const response = await this.executeAttempt<T>(request);
        return Object.freeze({ ...response, attempts: attempt });
      } catch (error) {
        const gateError = asGateError(error, request.signal, false);
        lastError = gateError;
        if (!gateError.retryable || attempt >= request.retry.attempts) {
          throw gateError;
        }

        const retryAfter = error instanceof HttpFailure ? error.retryAfterMs : undefined;
        const delay = retryAfter ?? exponentialBackoff(attempt, request.retry, this.random);
        if (request.deadlineAtMs !== undefined && this.clock() + delay > request.deadlineAtMs) {
          throw gateError;
        }
        await sleepWithCancellation(delay, request.signal, this.sleep);
      }
    }

    throw lastError ?? unavailable(new Error("Provider request ended without a result"));
  }

  private async executeAttempt<T>(
    request: TransportRequest
  ): Promise<Omit<TransportResponse<T>, "attempts">> {
    let url = await this.urlPolicy.validate(request.url, request.kind);
    const initialOrigin = url.origin;
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = (): void => controller.abort(cancelled(request.signal.reason));
    request.signal.addEventListener("abort", onParentAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(timeoutError());
    }, request.timeoutMs);

    try {
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        let response: Response;
        try {
          const init: RequestInit = {
            method: request.method ?? "GET",
            redirect: "manual",
            signal: controller.signal
          };
          if (request.headers !== undefined) {
            init.headers = request.headers;
          }
          if (request.body !== undefined) {
            init.body = request.body;
          }
          response = await this.fetchImplementation(url, init);
        } catch (cause) {
          throw asGateError(cause, request.signal, timedOut);
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await response.body?.cancel();
          if (location === null) {
            throw new GateError({
              code: "PROVIDER_PROTOCOL",
              safeMessage: "Provider redirect omitted its destination",
              retryable: false
            });
          }
          if (redirects === 3) {
            throw new GateError({
              code: "PROVIDER_PROTOCOL",
              safeMessage: "Provider returned too many redirects",
              retryable: false
            });
          }
          const redirectUrl = new URL(location, url);
          if (redirectUrl.origin !== initialOrigin) {
            throw new GateError({
              code: "SECURITY_POLICY",
              safeMessage: "Cross-origin provider redirects are forbidden",
              retryable: false
            });
          }
          url = await this.urlPolicy.validate(redirectUrl, request.kind);
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401) {
            throw new HttpFailure({
              code: "AUTHENTICATION",
              safeMessage: "Provider rejected authentication",
              retryable: false,
              httpStatus: response.status
            });
          }
          if (response.status === 403) {
            throw new HttpFailure({
              code: "AUTHORIZATION",
              safeMessage: "Provider denied authorization",
              retryable: false,
              httpStatus: response.status
            });
          }
          if (request.retry.retryStatuses.includes(response.status)) {
            const retryAfterMs = retryAfterMilliseconds(
              response.headers.get("retry-after"),
              this.clock()
            );
            throw new HttpFailure({
              code: "PROVIDER_UNAVAILABLE",
              safeMessage: `Provider returned retryable HTTP ${response.status}`,
              retryable: true,
              httpStatus: response.status,
              ...(retryAfterMs === undefined ? {} : { retryAfterMs })
            });
          }
          throw new HttpFailure({
            code: "PROVIDER_PROTOCOL",
            safeMessage: `Provider returned HTTP ${response.status}`,
            retryable: false,
            httpStatus: response.status
          });
        }

        const data =
          request.responseType === "none"
            ? await response.body?.cancel().then(() => undefined)
            : await readBoundedJson(response, request.maximumResponseBytes);
        return { status: response.status, data: data as T, headers: response.headers };
      }
      throw new GateError({
        code: "PROVIDER_PROTOCOL",
        safeMessage: "Provider returned too many redirects",
        retryable: false
      });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onParentAbort);
    }
  }
}
