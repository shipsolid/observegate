import {
  GateError,
  stableFingerprint,
  type Evidence,
  type EvidenceState
} from "@observability-gate/core";
import type { MetricsTransport } from "../metrics/types.js";

export interface HttpProbeRequest {
  readonly url: string;
  readonly method: "GET" | "HEAD";
  readonly expectedStatus: number;
  readonly expectedHeaders?: Readonly<Record<string, string>>;
  readonly expectedJson?: Readonly<Record<string, string | number | boolean | null>>;
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;
  readonly signal: AbortSignal;
  readonly deadlineAtMs?: number;
}

export interface HttpProbeEvidence {
  readonly status: number;
  readonly statusMatches: boolean;
  readonly headers: Readonly<Record<string, string | null>>;
  readonly headersMatch: boolean;
  readonly jsonMatches?: boolean;
}

export class HttpProbe {
  public constructor(
    private readonly options: {
      readonly transport: MetricsTransport;
      readonly clock?: () => number;
    }
  ) {}

  public async check(request: HttpProbeRequest): Promise<Evidence<HttpProbeEvidence>> {
    const acquiredAt = new Date((this.options.clock ?? Date.now)()).toISOString();
    const base = {
      id: stableFingerprint({
        url: new URL(request.url).origin + new URL(request.url).pathname,
        acquiredAt
      }),
      kind: "http.probe",
      source: Object.freeze({ provider: "http", capability: "probe" }),
      target: new URL(request.url).hostname,
      acquiredAt
    };
    try {
      const response = await this.options.transport.request({
        url: request.url,
        kind: "probe",
        method: request.method,
        timeoutMs: request.timeoutMs,
        maximumResponseBytes: request.maximumResponseBytes,
        responseType: request.method === "HEAD" ? "none" : "json",
        retry: {
          attempts: 2,
          initialBackoffMs: 200,
          maximumBackoffMs: 1_000,
          retryStatuses: [429, 502, 503, 504]
        },
        signal: request.signal,
        ...(request.deadlineAtMs === undefined ? {} : { deadlineAtMs: request.deadlineAtMs })
      });
      const selectedHeaders = Object.fromEntries(
        Object.keys(request.expectedHeaders ?? {}).map((name) => [
          name.toLowerCase(),
          response.headers.get(name)
        ])
      );
      const headersMatch = Object.entries(request.expectedHeaders ?? {}).every(
        ([name, expected]) => response.headers.get(name) === expected
      );
      let jsonMatches: boolean | undefined;
      if (request.expectedJson !== undefined) {
        const payload =
          response.data !== null &&
          typeof response.data === "object" &&
          !Array.isArray(response.data)
            ? (response.data as Record<string, unknown>)
            : undefined;
        jsonMatches =
          payload !== undefined &&
          Object.entries(request.expectedJson).every(([key, expected]) =>
            Object.is(payload[key], expected)
          );
      }
      const statusMatches = response.status === request.expectedStatus;
      const valid = statusMatches && headersMatch && (jsonMatches ?? true);
      const value: HttpProbeEvidence = Object.freeze({
        status: response.status,
        statusMatches,
        headers: Object.freeze(selectedHeaders),
        headersMatch,
        ...(jsonMatches === undefined ? {} : { jsonMatches })
      });
      return Object.freeze({
        ...base,
        state: valid ? "valid" : "invalid",
        value,
        diagnostics: Object.freeze([])
      });
    } catch (error) {
      const gateError =
        error instanceof GateError
          ? error
          : new GateError({
              code: "PROVIDER_UNAVAILABLE",
              safeMessage: "HTTP probe failed",
              retryable: true,
              cause: error
            });
      if (gateError.code === "SECURITY_POLICY" || gateError.code === "CANCELLED") throw gateError;
      const state: EvidenceState =
        gateError.code === "PROVIDER_PROTOCOL" ? "invalid" : "unavailable";
      return Object.freeze({
        ...base,
        state,
        diagnostics: Object.freeze([gateError.toDiagnostic()])
      });
    }
  }
}
