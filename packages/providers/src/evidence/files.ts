import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { GateError } from "@observability-gate/core";

export interface LoadedEvidenceFile {
  readonly relativePath: string;
  readonly canonicalPath: string;
  readonly mediaType: string;
  readonly size: number;
  readonly modifiedAt: string;
  readonly digest: string;
  readonly content: Buffer;
}

export interface EvidenceFileLoadRequest {
  readonly path: string;
  readonly blocking: boolean;
  readonly maximumAgeMs?: number;
  readonly maximumFutureSkewMs?: number;
}

export interface SafeEvidenceFileLoaderOptions {
  readonly workspaceRoot: string;
  readonly maximumBytes?: number;
  readonly clock?: () => number;
}

function error(
  code: "SECURITY_POLICY" | "EVIDENCE_INVALID",
  message: string,
  cause?: unknown
): GateError {
  return new GateError({ code, safeMessage: message, retryable: false, cause });
}

function contained(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".json":
    case ".sarif":
      return "application/json";
    case ".xml":
      return "application/xml";
    case ".jwt":
    case ".jws":
      return "application/jose";
    default:
      return "application/octet-stream";
  }
}

export class SafeEvidenceFileLoader {
  private readonly workspaceRoot: string;
  private readonly maximumBytes: number;
  private readonly clock: () => number;

  public constructor(options: SafeEvidenceFileLoaderOptions) {
    this.workspaceRoot = resolve(options.workspaceRoot);
    this.maximumBytes = options.maximumBytes ?? 25 * 1024 * 1024;
    this.clock = options.clock ?? Date.now;
  }

  public async load(request: EvidenceFileLoadRequest): Promise<LoadedEvidenceFile> {
    if (isAbsolute(request.path)) {
      throw error("SECURITY_POLICY", "Evidence path must be workspace-relative");
    }
    const root = await realpath(this.workspaceRoot);
    const candidate = resolve(root, request.path);
    if (!contained(root, candidate)) {
      throw error("SECURITY_POLICY", "Evidence path escapes the workspace");
    }

    let canonicalPath: string;
    try {
      await lstat(candidate);
      canonicalPath = await realpath(candidate);
    } catch (cause) {
      throw error("EVIDENCE_INVALID", "Evidence file does not exist", cause);
    }
    if (!contained(root, canonicalPath)) {
      throw error("SECURITY_POLICY", "Evidence symlink escapes the workspace");
    }

    const metadata = await stat(canonicalPath);
    if (!metadata.isFile()) {
      throw error("SECURITY_POLICY", "Evidence path is not a regular file");
    }
    if (request.blocking && (metadata.mode & 0o002) !== 0) {
      throw error("SECURITY_POLICY", "Blocking evidence must not be world-writable");
    }
    if (metadata.size > this.maximumBytes) {
      throw error("EVIDENCE_INVALID", "Evidence file exceeds the configured size limit");
    }

    const now = this.clock();
    if (request.maximumAgeMs !== undefined && now - metadata.mtimeMs > request.maximumAgeMs) {
      throw error("EVIDENCE_INVALID", "Evidence file is stale");
    }
    if (
      request.maximumFutureSkewMs !== undefined &&
      metadata.mtimeMs - now > request.maximumFutureSkewMs
    ) {
      throw error("EVIDENCE_INVALID", "Evidence file modification time is in the future");
    }

    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of createReadStream(canonicalPath)) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > this.maximumBytes) {
          throw error("EVIDENCE_INVALID", "Evidence file exceeded the configured size limit");
        }
        chunks.push(buffer);
      }
    } catch (cause) {
      if (cause instanceof GateError) throw cause;
      throw error("EVIDENCE_INVALID", "Evidence file could not be read", cause);
    }
    const content = Buffer.concat(chunks, bytes);
    return Object.freeze({
      relativePath: relative(root, canonicalPath),
      canonicalPath,
      mediaType: mediaType(canonicalPath),
      size: bytes,
      modifiedAt: metadata.mtime.toISOString(),
      digest: createHash("sha256").update(content).digest("hex"),
      content
    });
  }

  public async loadOptional(
    request: EvidenceFileLoadRequest
  ): Promise<LoadedEvidenceFile | undefined> {
    try {
      return await this.load(request);
    } catch (cause) {
      if (
        cause instanceof GateError &&
        cause.code === "EVIDENCE_INVALID" &&
        cause.safeMessage === "Evidence file does not exist"
      ) {
        return undefined;
      }
      throw cause;
    }
  }
}
