import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { GateError, type ExecutionResult } from "@observability-gate/core";
import { renderJson } from "./json.js";
import { renderJunit } from "./junit.js";
import { renderMarkdown } from "./markdown.js";
import { renderSarif } from "./sarif.js";

export type ReportFormat = "json" | "markdown" | "junit" | "sarif";

export interface WriteReportsOptions {
  readonly directory: string;
  readonly formats: readonly ReportFormat[];
  readonly maximumTotalBytes: number;
  readonly signal: AbortSignal;
}

export interface ReportPublication {
  readonly paths: Readonly<Partial<Record<ReportFormat, string>>>;
  readonly totalBytes: number;
}

const fileNames: Readonly<Record<ReportFormat, string>> = {
  json: "observability-gate.json",
  markdown: "observability-gate.md",
  junit: "observability-gate.xml",
  sarif: "observability-gate.sarif"
};

const renderers: Readonly<Record<ReportFormat, (result: ExecutionResult) => string>> = {
  json: renderJson,
  markdown: renderMarkdown,
  junit: renderJunit,
  sarif: renderSarif
};

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GateError({
      code: "CANCELLED",
      safeMessage: "Report publication was cancelled.",
      retryable: false
    });
  }
}

async function atomicWrite(path: string, content: string, signal: AbortSignal): Promise<void> {
  const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let created = false;
  try {
    checkCancellation(signal);
    const handle = await open(temporaryPath, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    checkCancellation(signal);
    await rename(temporaryPath, path);
    created = false;
  } finally {
    if (created) await rm(temporaryPath, { force: true });
  }
}

export async function writeReports(
  result: ExecutionResult,
  options: WriteReportsOptions
): Promise<ReportPublication> {
  checkCancellation(options.signal);
  const rendered = options.formats.map((format) => ({
    format,
    content: renderers[format](result),
    path: join(options.directory, fileNames[format])
  }));
  const totalBytes = rendered.reduce(
    (total, report) => total + Buffer.byteLength(report.content, "utf8"),
    0
  );
  if (totalBytes > options.maximumTotalBytes) {
    throw new GateError({
      code: "REPORTING",
      safeMessage: "The report set exceeds the configured total size limit.",
      retryable: false
    });
  }
  await mkdir(options.directory, { recursive: true });
  const paths: Partial<Record<ReportFormat, string>> = {};
  for (const report of rendered) {
    await atomicWrite(report.path, report.content, options.signal);
    paths[report.format] = report.path;
  }
  return Object.freeze({ paths: Object.freeze(paths), totalBytes });
}
