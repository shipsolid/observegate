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

async function stageWrite(path: string, content: string, signal: AbortSignal): Promise<string> {
  const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    checkCancellation(signal);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return temporaryPath;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function writeReports(
  result: ExecutionResult,
  options: WriteReportsOptions
): Promise<ReportPublication> {
  checkCancellation(options.signal);
  await mkdir(options.directory, { recursive: true });
  const staged: {
    readonly format: ReportFormat;
    readonly path: string;
    readonly temporary: string;
  }[] = [];
  let totalBytes = 0;
  try {
    for (const format of options.formats) {
      checkCancellation(options.signal);
      const content = renderers[format](result);
      totalBytes += Buffer.byteLength(content, "utf8");
      if (totalBytes > options.maximumTotalBytes) {
        throw new GateError({
          code: "REPORTING",
          safeMessage: "The report set exceeds the configured total size limit.",
          retryable: false
        });
      }
      const path = join(options.directory, fileNames[format]);
      staged.push({ format, path, temporary: await stageWrite(path, content, options.signal) });
    }
    checkCancellation(options.signal);
    for (const report of staged) await rename(report.temporary, report.path);
  } catch (error) {
    await Promise.all(staged.map((report) => rm(report.temporary, { force: true })));
    throw error;
  }
  const paths: Partial<Record<ReportFormat, string>> = {};
  for (const report of staged) paths[report.format] = report.path;
  return Object.freeze({ paths: Object.freeze(paths), totalBytes });
}
