import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { GateError, type ExecutionResult } from "@observability-gate/core";
import { jsonReportChunks } from "./json.js";
import { junitReportChunks } from "./junit.js";
import { markdownReportChunks } from "./markdown.js";
import { sarifReportChunks } from "./sarif.js";

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

const renderers: Readonly<Record<ReportFormat, (result: ExecutionResult) => Iterable<string>>> = {
  json: jsonReportChunks,
  markdown: markdownReportChunks,
  junit: junitReportChunks,
  sarif: sarifReportChunks
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

async function stageWrite(
  path: string,
  chunks: Iterable<string>,
  maximumBytes: number,
  signal: AbortSignal
): Promise<{ readonly temporary: string; readonly bytes: number }> {
  const temporaryPath = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    checkCancellation(signal);
    const handle = await open(temporaryPath, "wx", 0o600);
    let bytes = 0;
    let pending = "";
    let pendingBytes = 0;
    try {
      for (const raw of chunks) {
        for (let offset = 0; offset < raw.length;) {
          let end = Math.min(raw.length, offset + 16 * 1024);
          const last = raw.charCodeAt(end - 1);
          if (end < raw.length && last >= 0xd800 && last <= 0xdbff) end += 1;
          const chunk = raw.slice(offset, end);
          const chunkBytes = Buffer.byteLength(chunk, "utf8");
          bytes += chunkBytes;
          if (bytes > maximumBytes) {
            throw new GateError({
              code: "REPORTING",
              safeMessage: "The report set exceeds the configured total size limit.",
              retryable: false
            });
          }
          pending += chunk;
          pendingBytes += chunkBytes;
          if (pendingBytes >= 64 * 1024) {
            await handle.writeFile(pending, "utf8");
            pending = "";
            pendingBytes = 0;
            checkCancellation(signal);
          }
          offset = end;
        }
      }
      if (pendingBytes > 0) await handle.writeFile(pending, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { temporary: temporaryPath, bytes };
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
  const backups: { readonly path: string; readonly backup: string }[] = [];
  const installed: string[] = [];
  let totalBytes = 0;
  try {
    for (const format of options.formats) {
      checkCancellation(options.signal);
      const path = join(options.directory, fileNames[format]);
      const report = await stageWrite(
        path,
        renderers[format](result),
        options.maximumTotalBytes - totalBytes,
        options.signal
      );
      totalBytes += report.bytes;
      staged.push({ format, path, temporary: report.temporary });
    }
    checkCancellation(options.signal);
    for (const report of staged) {
      try {
        const status = await lstat(report.path);
        if (!status.isFile()) {
          throw new GateError({
            code: "REPORTING",
            safeMessage: "A report destination is not a regular file.",
            retryable: false
          });
        }
        const backup = `${report.path}.backup-${process.pid}-${crypto.randomUUID()}`;
        await rename(report.path, backup);
        backups.push({ path: report.path, backup });
      } catch (error) {
        if (!(
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        )) {
          throw error;
        }
      }
    }
    for (const report of staged) {
      await rename(report.temporary, report.path);
      installed.push(report.path);
    }
  } catch (error) {
    const removalResults = await Promise.allSettled(
      installed.map((path) => rm(path, { force: true }))
    );
    const restorationResults = await Promise.allSettled(
      backups.toReversed().map(({ path, backup }) => rename(backup, path))
    );
    const temporaryCleanupResults = await Promise.allSettled(
      staged.map((report) => rm(report.temporary, { force: true }))
    );
    const rollbackResults = [...removalResults, ...restorationResults, ...temporaryCleanupResults];
    const rollbackFailures = rollbackResults.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    );
    if (rollbackFailures.length > 0) {
      throw new GateError({
        code: "REPORTING",
        safeMessage:
          "Report publication failed and the prior report set could not be fully restored.",
        retryable: false,
        cause: new AggregateError([error, ...rollbackFailures])
      });
    }
    throw error;
  }
  const cleanupResults = await Promise.allSettled(
    backups.map(({ backup }) => rm(backup, { force: true }))
  );
  const cleanupFailures = cleanupResults.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (cleanupFailures.length > 0) {
    throw new GateError({
      code: "REPORTING",
      safeMessage: "Reports were published, but the prior report set could not be removed.",
      retryable: false,
      cause: new AggregateError(cleanupFailures)
    });
  }
  const paths: Partial<Record<ReportFormat, string>> = {};
  for (const report of staged) paths[report.format] = report.path;
  return Object.freeze({ paths: Object.freeze(paths), totalBytes });
}
