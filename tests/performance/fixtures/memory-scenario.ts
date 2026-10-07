import { rm } from "node:fs/promises";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { parseByteSize, type ExecutionResult, type GateResult } from "@observability-gate/core";
import { GuardedTransport, UrlPolicy } from "@observability-gate/providers";
import { writeReports } from "@observability-gate/reporters";

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

function responseBody(bytes: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const prefix = encoder.encode('{"data":"');
  const suffix = encoder.encode('"}');
  let remaining = bytes - prefix.byteLength - suffix.byteLength;
  let prefixPending = true;
  return new ReadableStream({
    pull(controller) {
      if (prefixPending) {
        prefixPending = false;
        controller.enqueue(prefix);
        return;
      }
      if (remaining > 0) {
        const size = Math.min(64 * 1024, remaining);
        remaining -= size;
        controller.enqueue(encoder.encode("e".repeat(size)));
        return;
      }
      controller.enqueue(suffix);
      controller.close();
    }
  });
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}

async function withExactReportSetSize(
  result: ExecutionResult,
  bytes: number,
  directory: string,
  signal: AbortSignal
): Promise<ExecutionResult> {
  const base = { ...result, configurationFingerprint: "", links: { padding: "" } };
  const calibrationDirectory = `${directory}/calibration`;
  const baseBytes = (
    await writeReports(base, {
      directory: calibrationDirectory,
      formats: reportFormats,
      maximumTotalBytes: Number.MAX_SAFE_INTEGER,
      signal
    })
  ).totalBytes;
  await rm(calibrationDirectory, { recursive: true });
  if (baseBytes > bytes)
    throw new Error("The 200-gate report exceeds the configured fixture size.");
  const remaining = bytes - baseBytes;
  return {
    ...base,
    configurationFingerprint: "f".repeat(remaining % 2),
    links: { padding: "x".repeat(Math.floor(remaining / 2)) }
  };
}

export interface MemoryScenarioMetrics {
  readonly gateCount: number;
  readonly responseBytes: number;
  readonly reportBytes: number;
  readonly retainedHeapBytes: number;
  readonly peakRssGrowthBytes: number;
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
  const baselinePeakRssBytes = process.resourceUsage().maxRSS * 1024;
  let responseBytes = maximumProviderResponseBytes;
  const transport = new GuardedTransport({
    urlPolicy: new UrlPolicy({
      providerOrigins: ["https://metrics.example.com"],
      probeHosts: [],
      resolve: async () => ["93.184.216.34"]
    }),
    fetch: async () => new Response(responseBody(responseBytes), { status: 200 })
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
  responseBytes = maximumProviderResponseBytes + 1;
  let providerRejectedOverLimit = false;
  try {
    await transport.request(request);
  } catch (error) {
    providerRejectedOverLimit = errorCode(error) === "PROVIDER_PROTOCOL";
  }
  collectGarbage();
  responseBytes = maximumProviderResponseBytes;
  let accepted: { readonly data: { readonly data: string }; readonly status: number } | undefined =
    await transport.request<{ readonly data: string }>(request);

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
  accepted = undefined;
  collectGarbage();
  const exactLimitExecution = await withExactReportSetSize(
    execution,
    maximumReportBytes,
    directory,
    request.signal
  );
  collectGarbage();
  const publication = await writeReports(exactLimitExecution, {
    directory: `${directory}/accepted`,
    formats: reportFormats,
    maximumTotalBytes: maximumReportBytes,
    signal: request.signal
  });
  collectGarbage();

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
  const peakRssGrowthBytes = Math.max(
    0,
    process.resourceUsage().maxRSS * 1024 - baselinePeakRssBytes
  );
  collectGarbage();

  return {
    gateCount,
    responseBytes,
    reportBytes: publication.totalBytes,
    retainedHeapBytes: Math.max(0, process.memoryUsage().heapUsed - baselineHeapBytes),
    peakRssGrowthBytes,
    maximumProviderResponseBytes,
    maximumReportBytes,
    providerRejectedOverLimit,
    reporterRejectedOverLimit
  };
}
