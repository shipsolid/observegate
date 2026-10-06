import { GateError } from "@observability-gate/core";

export interface RetryPolicy {
  readonly attempts: number;
  readonly initialBackoffMs: number;
  readonly maximumBackoffMs: number;
  readonly retryStatuses: readonly number[];
}

export function exponentialBackoff(
  failedAttempt: number,
  policy: RetryPolicy,
  random: () => number
): number {
  const base = Math.min(
    policy.maximumBackoffMs,
    policy.initialBackoffMs * 2 ** Math.max(0, failedAttempt - 1)
  );
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.round(base * jitter);
}

export async function sleepWithCancellation(
  delayMs: number,
  signal: AbortSignal,
  sleep: (delayMs: number) => Promise<void>
): Promise<void> {
  if (signal.aborted) {
    throw cancelled(signal.reason);
  }

  let removeAbortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => reject(cancelled(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", onAbort);
  });

  try {
    await Promise.race([sleep(delayMs), aborted]);
  } finally {
    removeAbortListener?.();
  }
}

export function cancelled(cause?: unknown): GateError {
  return new GateError({
    code: "CANCELLED",
    safeMessage: "Provider request was cancelled",
    retryable: false,
    cause
  });
}
