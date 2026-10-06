import {
  GateError,
  classifyFreshness,
  fingerprintQuery,
  stableFingerprint,
  type Diagnostic,
  type Evidence,
  type EvidenceState
} from "@observability-gate/core";
import type { TransportRequest } from "../transport/guarded-fetch.js";
import type {
  LogRecordEvidence,
  LogRecordSummary,
  LogsProvider,
  LokiRangeRequest,
  LokiTransport
} from "./types.js";

export interface LokiClientOptions {
  readonly endpoint: string;
  readonly provider: string;
  readonly transport: LokiTransport;
  readonly maximumLimit: number;
  readonly maximumRangeMs: number;
  readonly timeoutMs?: number;
  readonly maximumResponseBytes?: number;
  readonly headers?: HeadersInit;
  readonly clock?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function labels(value: unknown): Readonly<Record<string, string>> | undefined {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    return undefined;
  }
  return Object.freeze({ ...(value as Record<string, string>) });
}

function timestampFromNanoseconds(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) {
    return undefined;
  }
  try {
    const milliseconds = Number(BigInt(value) / 1_000_000n);
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticsForWarnings(warnings: readonly string[]): readonly Diagnostic[] {
  return Object.freeze(
    warnings.map((message) => ({ code: "PROVIDER_PROTOCOL", message, retryable: false }))
  );
}

function validateSelector(query: string): void {
  const selector = query.match(/^\s*\{([^}]*)\}/u)?.[1];
  const boundedMatcher = selector?.match(/(?:^|,)\s*[A-Za-z_][\w]*\s*(?:=|=~)\s*"([^"]+)"/u)?.[1];
  if (
    selector === undefined ||
    boundedMatcher === undefined ||
    boundedMatcher === ".*" ||
    boundedMatcher === ".+"
  ) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "Loki production queries require a bounded positive stream selector",
      retryable: false
    });
  }
}

function parseRange(
  request: LokiRangeRequest,
  maximumRangeMs: number
): { startMs: number; endMs: number } {
  const startMs = Date.parse(request.start);
  const endMs = Date.parse(request.end);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    endMs - startMs > maximumRangeMs ||
    !Number.isInteger(request.limit) ||
    request.limit < 1
  ) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "Loki query range or limit is outside the configured bounds",
      retryable: false
    });
  }
  return { startMs, endMs };
}

export class LokiClient implements LogsProvider {
  private readonly endpoint: URL;
  private readonly options: LokiClientOptions;
  private readonly clock: () => number;

  public constructor(options: LokiClientOptions) {
    this.endpoint = new URL(
      options.endpoint.endsWith("/") ? options.endpoint : `${options.endpoint}/`
    );
    this.options = options;
    this.clock = options.clock ?? Date.now;
  }

  public async queryRange(request: LokiRangeRequest): Promise<Evidence<LogRecordEvidence>> {
    validateSelector(request.query);
    const { startMs, endMs } = parseRange(request, this.options.maximumRangeMs);
    const acquiredAt = new Date(this.clock()).toISOString();
    const queryFingerprint = fingerprintQuery(request.query);
    const limit = Math.min(request.limit, this.options.maximumLimit);
    const base = {
      id: stableFingerprint({
        provider: this.options.provider,
        capability: "logs.query.range",
        target: request.target,
        queryFingerprint,
        acquiredAt
      }),
      kind: "logs.records",
      source: Object.freeze({
        provider: this.options.provider,
        capability: "logs.query.range",
        queryFingerprint
      }),
      target: request.target,
      ...(request.releaseId === undefined ? {} : { releaseId: request.releaseId }),
      acquiredAt
    };

    let payload: unknown;
    try {
      payload = (
        await this.options.transport.request(this.transportRequest(request, startMs, endMs, limit))
      ).data;
    } catch (error) {
      const gateError =
        error instanceof GateError
          ? error
          : new GateError({
              code: "PROVIDER_UNAVAILABLE",
              safeMessage: "Loki request failed",
              retryable: true,
              cause: error
            });
      if (gateError.code === "CANCELLED") {
        throw gateError;
      }
      return Object.freeze({
        ...base,
        state: gateError.code === "PROVIDER_PROTOCOL" ? "invalid" : "unavailable",
        diagnostics: Object.freeze([gateError.toDiagnostic()])
      });
    }

    const normalized = this.normalize(payload, request, acquiredAt, limit);
    return Object.freeze({ ...base, ...normalized });
  }

  private normalize(
    payload: unknown,
    request: LokiRangeRequest,
    acquiredAt: string,
    limit: number
  ): {
    state: EvidenceState;
    observedAt?: string;
    value?: LogRecordEvidence;
    diagnostics: readonly Diagnostic[];
  } {
    if (
      !isRecord(payload) ||
      payload.status !== "success" ||
      !isRecord(payload.data) ||
      payload.data.resultType !== "streams" ||
      !Array.isArray(payload.data.result)
    ) {
      return this.invalid("Loki returned an invalid response envelope");
    }
    const warnings =
      payload.warnings === undefined
        ? []
        : Array.isArray(payload.warnings) &&
            payload.warnings.every((item) => typeof item === "string")
          ? (payload.warnings as string[])
          : undefined;
    if (warnings === undefined) {
      return this.invalid("Loki returned malformed warnings");
    }

    const records: LogRecordSummary[] = [];
    for (const stream of payload.data.result) {
      if (!isRecord(stream) || !Array.isArray(stream.values)) {
        return this.invalid("Loki returned a malformed stream");
      }
      const streamLabels = labels(stream.stream);
      if (streamLabels === undefined) {
        return this.invalid("Loki returned malformed stream labels");
      }
      for (const tuple of stream.values) {
        if (!Array.isArray(tuple) || tuple.length < 2 || typeof tuple[1] !== "string") {
          return this.invalid("Loki returned a malformed log tuple");
        }
        const timestamp = timestampFromNanoseconds(tuple[0]);
        if (timestamp === undefined) {
          return this.invalid("Loki returned a malformed nanosecond timestamp");
        }
        const rawMetadata = tuple[2] === undefined ? {} : labels(tuple[2]);
        if (rawMetadata === undefined) {
          return this.invalid("Loki returned malformed structured metadata");
        }
        const selectedMetadata = Object.fromEntries(
          (request.structuredMetadataFields ?? [])
            .filter((field) => rawMetadata[field] !== undefined)
            .map((field) => [field, rawMetadata[field] as string])
        );
        const traceId = rawMetadata.trace_id;
        const spanId = rawMetadata.span_id;
        records.push(
          Object.freeze({
            timestamp,
            labels: streamLabels,
            structuredMetadata: Object.freeze(selectedMetadata),
            byteCount: Buffer.byteLength(tuple[1], "utf8"),
            ...(traceId === undefined ? {} : { traceId }),
            ...(spanId === undefined ? {} : { spanId })
          })
        );
      }
    }
    const observedAt = records.reduce<string | undefined>(
      (latest, record) =>
        latest === undefined || record.timestamp > latest ? record.timestamp : latest,
      undefined
    );
    const state =
      observedAt === undefined
        ? "missing"
        : classifyFreshness({
            observedAt,
            acquiredAt,
            sampleCount: records.length,
            minimumSamples: request.minimumRecords,
            maximumAgeMs: request.maximumAgeMs,
            maximumFutureSkewMs: request.maximumFutureSkewMs
          });
    const value = Object.freeze({
      records: Object.freeze(records),
      recordCount: records.length,
      range: Object.freeze({
        start: request.start,
        end: request.end,
        direction: request.direction,
        limit
      }),
      warnings: Object.freeze(warnings)
    });
    return {
      state,
      ...(observedAt === undefined ? {} : { observedAt }),
      value,
      diagnostics: diagnosticsForWarnings(warnings)
    };
  }

  private invalid(message: string): { state: "invalid"; diagnostics: readonly Diagnostic[] } {
    return {
      state: "invalid",
      diagnostics: Object.freeze([{ code: "EVIDENCE_INVALID", message, retryable: false }])
    };
  }

  private transportRequest(
    request: LokiRangeRequest,
    startMs: number,
    endMs: number,
    limit: number
  ): TransportRequest {
    const url = new URL("api/v1/query_range", this.endpoint);
    url.search = new URLSearchParams({
      query: request.query,
      start: String(BigInt(startMs) * 1_000_000n),
      end: String(BigInt(endMs) * 1_000_000n),
      direction: request.direction,
      limit: String(limit)
    }).toString();
    return {
      url,
      kind: "provider",
      headers: this.options.headers ?? {},
      timeoutMs: this.options.timeoutMs ?? 10_000,
      maximumResponseBytes: this.options.maximumResponseBytes ?? 2 * 1024 * 1024,
      retry: {
        attempts: 3,
        initialBackoffMs: 200,
        maximumBackoffMs: 2_000,
        retryStatuses: [429, 502, 503, 504]
      },
      signal: request.signal ?? new AbortController().signal,
      ...(request.deadlineAtMs === undefined ? {} : { deadlineAtMs: request.deadlineAtMs })
    };
  }
}
