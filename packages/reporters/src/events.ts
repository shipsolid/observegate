import { constants, closeSync, fchmodSync, openSync, writeSync } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GateError, type ExecutionEvent } from "@observability-gate/core";

export interface EventWriter {
  readonly write: (event: ExecutionEvent) => void;
  readonly close: () => void;
}

function security(): never {
  throw new GateError({
    code: "SECURITY_POLICY",
    safeMessage: "Diagnostic event path must stay inside the workspace without symlinks.",
    retryable: false
  });
}

export async function createEventWriter(options: {
  readonly workspaceRoot: string;
  readonly path: string;
  readonly maximumBytes?: number;
}): Promise<EventWriter> {
  const root = await realpath(options.workspaceRoot);
  if (isAbsolute(options.path)) security();
  const path = resolve(root, options.path),
    child = relative(root, path);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`)) security();
  let parent = root;
  for (const segment of relative(root, dirname(path)).split(sep).filter(Boolean)) {
    parent = join(parent, segment);
    await mkdir(parent, { mode: 0o700 }).catch((error: unknown) => {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    });
    if ((await realpath(parent)) !== parent) security();
  }
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o600
    );
  } catch (cause) {
    throw new GateError({
      code: "REPORTING",
      safeMessage: "Diagnostic event stream could not be opened.",
      retryable: false,
      cause
    });
  }
  fchmodSync(descriptor, 0o600);
  let bytes = 0,
    closed = false;
  return {
    write(event) {
      const safe: Record<string, unknown> = { name: event.name, at: event.at };
      for (const key of ["phase", "provider", "gateId", "status", "decision"] as const) {
        const value = event[key];
        if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/u.test(value)) safe[key] = value;
      }
      for (const key of ["durationMs", "attempt"] as const) {
        const value = event[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = value;
      }
      const line = `${JSON.stringify(safe)}\n`;
      const size = Buffer.byteLength(line);
      if (closed || bytes + size > (options.maximumBytes ?? 2 * 1024 * 1024))
        throw new GateError({
          code: "REPORTING",
          safeMessage: "Diagnostic event stream exceeds its size limit.",
          retryable: false
        });
      writeSync(descriptor, line);
      bytes += size;
    },
    close() {
      if (!closed) {
        closed = true;
        closeSync(descriptor);
      }
    }
  };
}
