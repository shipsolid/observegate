import type { Evidence } from "@observability-gate/core";
import type { MetricsTransport } from "../metrics/types.js";

export interface LogRecordSummary {
  readonly timestamp: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly structuredMetadata: Readonly<Record<string, string>>;
  readonly byteCount: number;
  readonly traceId?: string;
  readonly spanId?: string;
}

export interface LogRecordEvidence {
  readonly records: readonly LogRecordSummary[];
  readonly recordCount: number;
  readonly range: {
    readonly start: string;
    readonly end: string;
    readonly direction: "forward" | "backward";
    readonly limit: number;
  };
  readonly warnings: readonly string[];
}

export interface LokiRangeRequest {
  readonly query: string;
  readonly target: string;
  readonly releaseId?: string;
  readonly start: string;
  readonly end: string;
  readonly direction: "forward" | "backward";
  readonly limit: number;
  readonly minimumRecords: number;
  readonly maximumAgeMs: number;
  readonly maximumFutureSkewMs: number;
  readonly structuredMetadataFields?: readonly string[];
  readonly signal?: AbortSignal;
  readonly deadlineAtMs?: number;
}

export interface LogsProvider {
  queryRange(request: LokiRangeRequest): Promise<Evidence<LogRecordEvidence>>;
}

export type LokiTransport = MetricsTransport;
