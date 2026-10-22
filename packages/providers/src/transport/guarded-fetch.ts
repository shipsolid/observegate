import { pinnedFetch } from "./pinned-fetch.js";
import { GateError } from "@observability-gate/core";
import {
  cancelled,
  exponentialBackoff,
  sleepWithCancellation,
  type RetryPolicy,
  withCancellation
} from "./retry.js";
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
  readonly responseType?: "json" | "none" | "text";
  readonly onRetry?: (attempt: number) => void;
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
  if (parentSignal.aborted) {
    return parentSignal.reason instanceof GateError
      ? parentSignal.reason
      : cancelled(parentSignal.reason ?? error);
  }
  if (error instanceof GateError) return error;
  if (timedOut) {
    return timeoutError(error);
  }
  return unavailable(error);
}

async function readBoundedBody(
  response: Response,
  limit: number,
  signal: AbortSignal,
  responseType: "json" | "text" = "json"
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > limit) {
    await withCancellation(async () => response.body?.cancel(), signal);
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

  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await withCancellation(() => reader.read(), signal);
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        await withCancellation(() => reader.cancel(), signal);
        throw new GateError({
          code: "PROVIDER_PROTOCOL",
          safeMessage: "Provider response exceeded the configured size limit",
          retryable: false
        });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (cause) {
    void reader.cancel().catch(() => undefined);
    if (signal.aborted) {
      throw signal.reason;
    }
    if (cause instanceof GateError) throw cause;
    throw new GateError({
      code: "PROVIDER_PROTOCOL",
      safeMessage: "Provider returned malformed JSON",
      retryable: false,
      cause
    });
  } finally {
    reader.releaseLock();
  }

  if (responseType === "text") return text;
  try {
    return JSON.parse(text) as unknown;
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
  private readonly fetchImplementation: FetchLike | undefined;
  private readonly sleep: ((delayMs: number) => Promise<void>) | undefined;
  private readonly random: () => number;
  private readonly clock: () => number;

  public constructor(options: GuardedTransportOptions) {
    this.urlPolicy = options.urlPolicy;
    this.fetchImplementation = options.fetch;
    this.sleep = options.sleep;
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

    const deadline = request.deadlineAtMs;
    if (deadline !== undefined && deadline <= this.clock()) throw timeoutError();
    const deadlineController = new AbortController();
    const deadlineTimer =
      deadline === undefined
        ? undefined
        : setTimeout(
            () => deadlineController.abort(timeoutError()),
            Math.max(0, deadline - this.clock())
          );
    const signal = AbortSignal.any([request.signal, deadlineController.signal]);
    try {
      let lastError: GateError | undefined;
      for (let attempt = 1; attempt <= request.retry.attempts; attempt += 1) {
        try {
          if (deadline !== undefined && deadline <= this.clock()) throw timeoutError();
          const response = await this.executeAttempt<T>({ ...request, signal });
          if (deadline !== undefined && deadline <= this.clock()) throw timeoutError();
          return Object.freeze({ ...response, attempts: attempt });
        } catch (error) {
          const gateError = asGateError(error, request.signal, false);
          lastError = gateError;
          const cause = gateError.cause;
          const connectionReset =
            cause !== null &&
            typeof cause === "object" &&
            "code" in cause &&
            cause.code === "ECONNRESET";
          const category =
            error instanceof HttpFailure
              ? `http_${error.httpStatus}`
              : gateError.safeMessage === "Provider request timed out"
                ? "timeout"
                : connectionReset
                  ? "connection_reset"
                  : undefined;
          if (
            !gateError.retryable ||
            attempt >= request.retry.attempts ||
            (request.retry.retryOn !== undefined &&
              (category === undefined || !request.retry.retryOn.includes(category)))
          ) {
            throw gateError;
          }

          const retryAfter = error instanceof HttpFailure ? error.retryAfterMs : undefined;
          const delay = retryAfter ?? exponentialBackoff(attempt, request.retry, this.random);
          if (request.deadlineAtMs !== undefined && this.clock() + delay >= request.deadlineAtMs) {
            throw gateError;
          }
          request.onRetry?.(attempt + 1);
          await withCancellation(() => sleepWithCancellation(delay, signal, this.sleep), signal);
        }
      }

      throw lastError ?? unavailable(new Error("Provider request ended without a result"));
    } finally {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    }
  }

  private async executeAttempt<T>(
    request: TransportRequest
  ): Promise<Omit<TransportResponse<T>, "attempts">> {
    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = (): void =>
      controller.abort(
        request.signal.reason instanceof GateError
          ? request.signal.reason
          : cancelled(request.signal.reason)
      );
    request.signal.addEventListener("abort", onParentAbort, { once: true });
    const timeout = setTimeout(
      () => {
        timedOut = true;
        controller.abort(timeoutError());
      },
      Math.min(
        request.timeoutMs,
        request.deadlineAtMs === undefined
          ? Infinity
          : Math.max(0, request.deadlineAtMs - this.clock())
      )
    );
    if (request.signal.aborted) onParentAbort();

    try {
      let resolved = await withCancellation(
        () => this.urlPolicy.resolve(request.url, request.kind, controller.signal),
        controller.signal
      );
      let url = resolved.url;
      const initialOrigin = url.origin;
      for (let redirects = 0; redirects <= 3; redirects += 1) {
        if (request.deadlineAtMs !== undefined && request.deadlineAtMs <= this.clock())
          throw timeoutError();
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
          response = await withCancellation(
            () =>
              this.fetchImplementation === undefined
                ? pinnedFetch(url, init, resolved.addresses)
                : this.fetchImplementation(url, init),
            controller.signal
          );
        } catch (cause) {
          throw asGateError(cause, request.signal, timedOut);
        }

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          await withCancellation(async () => response.body?.cancel(), controller.signal);
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
          resolved = await withCancellation(
            () => this.urlPolicy.resolve(redirectUrl, request.kind, controller.signal),
            controller.signal
          );
          url = resolved.url;
          continue;
        }

        if (!response.ok) {
          await withCancellation(async () => response.body?.cancel(), controller.signal);
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
            ? await withCancellation(
                async () => response.body?.cancel().then(() => undefined),
                controller.signal
              )
            : await readBoundedBody(
                response,
                request.maximumResponseBytes,
                controller.signal,
                request.responseType
              );
        if (controller.signal.aborted) throw controller.signal.reason;
        return { status: response.status, data: data as T, headers: response.headers };
      }
      throw new GateError({
        code: "PROVIDER_PROTOCOL",
        safeMessage: "Provider returned too many redirects",
        retryable: false
      });
    } catch (cause) {
      throw asGateError(cause, request.signal, timedOut);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onParentAbort);
    }
  }
}
