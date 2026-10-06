import type { ErrorCode } from "../errors/codes.js";
import { GateError } from "../errors/gate-error.js";

export interface Deadline {
  readonly signal: AbortSignal;
  readonly dispose: () => void;
}

export function cancellationError(message = "Execution was cancelled."): GateError {
  return new GateError({ code: "CANCELLED", safeMessage: message, retryable: false });
}

export function deadlineError(message: string): GateError {
  return new GateError({ code: "GATE_EVALUATION", safeMessage: message, retryable: false });
}

export function createDeadline(
  parent: AbortSignal,
  timeoutMs: number,
  options: { readonly code?: ErrorCode; readonly message?: string } = {}
): Deadline {
  const controller = new AbortController();
  const cancel = () =>
    controller.abort(parent.reason instanceof GateError ? parent.reason : cancellationError());
  if (parent.aborted) cancel();
  else parent.addEventListener("abort", cancel, { once: true });

  const timeout = setTimeout(
    () => {
      controller.abort(
        new GateError({
          code: options.code ?? "GATE_EVALUATION",
          safeMessage: options.message ?? `Execution exceeded ${timeoutMs} ms.`,
          retryable: false
        })
      );
    },
    Math.max(0, timeoutMs)
  );

  return Object.freeze({
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parent.removeEventListener("abort", cancel);
    }
  });
}

export function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? cancellationError());
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason ?? cancellationError()), {
      once: true
    });
  });
}

export async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      abortPromise(signal)
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
