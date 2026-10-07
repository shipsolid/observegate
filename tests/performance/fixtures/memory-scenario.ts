import type { ExecutionResult, GateResult } from "../../../packages/core/src/index.ts";
import { parseByteSize } from "../../../packages/core/src/index.ts";
import { GuardedTransport } from "../../../packages/providers/src/transport/guarded-fetch.ts";
import { UrlPolicy } from "../../../packages/providers/src/transport/url-policy.ts";
import { writeReports } from "../../../packages/reporters/src/files.ts";
import { renderJson } from "../../../packages/reporters/src/json.ts";
import { renderJunit } from "../../../packages/reporters/src/junit.ts";
import { renderMarkdown } from "../../../packages/reporters/src/markdown.ts";
import { renderSarif } from "../../../packages/reporters/src/sarif.ts";

const gateCount = 200;
const assertionsPerGate = 12;
const evidencePerGate = 12;
const configuredLimits = {
  maximum_provider_response_size: "10MiB",
  maximum_report_size: "25MiB"
} as const;
const reportFormats = ["json", "markdown", "junit", "sarif"] as const;

setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

function gate(index: number, retainedEvidence: { readonly data: string }): GateResult {
  const padding = retainedEvidence.data.slice(0, 900);
  return {
    id: `gate-${index}`,
    name: `Worst-case gate ${index}`,
    type: "telemetry.contract",
    phase: "post_deployment",
    enforcement: "blocking",
    status: "passed",
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:00:01.000Z",
    durationMs: 1_000,
    assertions: Array.from({ length: assertionsPerGate }, (_, assertionIndex) => ({
      assertion: `assertion-${assertionIndex}`,
      status: "passed" as const,
      expected: `${index}-${assertionIndex}-expected-${padding}`,
      observed: `${index}-${assertionIndex}-observed-${padding}`,
      message: `${index}-${assertionIndex}-message-${padding}`,
      unit: "ratio",
      window: "5m",
      sampleCount: 1_000
    })),
    evidence: Array.from({ length: evidencePerGate }, (_, evidenceIndex) => ({
      id: `evidence-${index}-${evidenceIndex}`,
      kind: "metrics.matrix",
      provider: "metrics",
      observedAt: "2026-10-07T00:00:00.000Z",
      acquiredAt: "2026-10-07T00:00:01.000Z",
      ageMs: 1_000,
      fingerprint: `${index.toString(16).padStart(4, "0")}${evidenceIndex.toString(16).padStart(4, "0")}${"f".repeat(56)}`
    })),
    diagnostics: []
  };
}

function responseBody(bytes: number): string {
  const empty = JSON.stringify({ data: "" });
  return JSON.stringify({ data: "e".repeat(bytes - Buffer.byteLength(empty)) });
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

function renderedReportBytes(result: ExecutionResult): number {
  let total = 0;
  for (const render of [renderJson, renderMarkdown, renderJunit, renderSarif]) {
    total += Buffer.byteLength(render(result));
  }
  return total;
}

function withExactReportSetSize(result: ExecutionResult, bytes: number): ExecutionResult {
  const base = { ...result, configurationFingerprint: "", links: { padding: "" } };
  const baseBytes = renderedReportBytes(base);
  if (baseBytes > bytes)
    throw new Error("The 200-gate report exceeds the configured fixture size.");
  const remaining = bytes - baseBytes;
  const padded = {
    ...base,
    configurationFingerprint: "f".repeat(remaining % 2),
    links: { padding: "x".repeat(Math.floor(remaining / 2)) }
  };
  if (renderedReportBytes(padded) !== bytes) {
    throw new Error("The production report set could not be calibrated to its configured limit.");
  }
  return padded;
}

export interface MemoryScenarioMetrics {
  readonly gateCount: number;
  readonly responseBytes: number;
  readonly reportBytes: number;
  readonly retainedHeapBytes: number;
  readonly maximumProviderResponseBytes: number;
  readonly maximumReportBytes: number;
  readonly providerRejectedOverLimit: boolean;
  readonly reporterRejectedOverLimit: boolean;
}

export async function runMemoryScenario(directory: string): Promise<MemoryScenarioMetrics> {
  const maximumProviderResponseBytes = parseByteSize(
    configuredLimits.maximum_provider_response_size,
    1
  );
  const maximumReportBytes = parseByteSize(configuredLimits.maximum_report_size, 1);
  collectGarbage();
  const baselineHeapBytes = process.memoryUsage().heapUsed;
  let body = responseBody(maximumProviderResponseBytes);
  const responseBytes = Buffer.byteLength(body);
  const transport = new GuardedTransport({
    urlPolicy: new UrlPolicy({
      providerOrigins: ["https://metrics.example.com"],
      probeHosts: [],
      resolve: async () => ["93.184.216.34"]
    }),
    fetch: async () => new Response(body, { status: 200 })
  });
  const request = {
    url: "https://metrics.example.com/api/v1/query",
    kind: "provider" as const,
    timeoutMs: 10_000,
    maximumResponseBytes: maximumProviderResponseBytes,
    retry: {
      attempts: 1,
      initialBackoffMs: 1,
      maximumBackoffMs: 1,
      retryStatuses: []
    },
    signal: new AbortController().signal,
    responseType: "json" as const
  };
  const accepted = await transport.request<{ readonly data: string }>(request);

  body = responseBody(maximumProviderResponseBytes + 1);
  let providerRejectedOverLimit = false;
  try {
    await transport.request(request);
  } catch (error) {
    providerRejectedOverLimit = errorCode(error) === "PROVIDER_PROTOCOL";
  }
  body = "";

  const execution: ExecutionResult = {
    decision: "pass",
    phase: "post_deployment",
    target: { id: "production", runtimeType: "kubernetes", provider: "kubernetes" },
    release: { candidateId: "release-candidate", deploymentId: "deployment-1" },
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:01:00.000Z",
    evidenceCoveragePercent: 100,
    gates: Array.from({ length: gateCount }, (_, index) => gate(index, accepted.data)),
    diagnostics: [],
    links: {}
  };
  const exactLimitExecution = withExactReportSetSize(execution, maximumReportBytes);
  const publication = await writeReports(exactLimitExecution, {
    directory: `${directory}/accepted`,
    formats: reportFormats,
    maximumTotalBytes: maximumReportBytes,
    signal: request.signal
  });

  let reporterRejectedOverLimit = false;
  try {
    await writeReports(
      {
        ...exactLimitExecution,
        links: { padding: `${exactLimitExecution.links.padding ?? ""}x` }
      },
      {
        directory: `${directory}/rejected`,
        formats: reportFormats,
        maximumTotalBytes: maximumReportBytes,
        signal: request.signal
      }
    );
  } catch (error) {
    reporterRejectedOverLimit = errorCode(error) === "REPORTING";
  }
  collectGarbage();

  return {
    gateCount,
    responseBytes,
    reportBytes: publication.totalBytes,
    retainedHeapBytes: Math.max(0, process.memoryUsage().heapUsed - baselineHeapBytes),
    maximumProviderResponseBytes,
    maximumReportBytes,
    providerRejectedOverLimit,
    reporterRejectedOverLimit
  };
}
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
