import { GateError } from "@observability-gate/core";

export function azureStatusCode(error: unknown): number | undefined {
  if (error !== null && typeof error === "object") {
    const candidate =
      (error as { statusCode?: unknown; status?: unknown }).statusCode ??
      (error as { status?: unknown }).status;
    return typeof candidate === "number" ? candidate : undefined;
  }
  return undefined;
}

export function mapAzureError(error: unknown, resource: string): GateError {
  if (error instanceof GateError) return error;
  const status = azureStatusCode(error);
  return new GateError({
    code:
      status === 401
        ? "AUTHENTICATION"
        : status === 403
          ? "AUTHORIZATION"
          : status === 404
            ? "EVIDENCE_INVALID"
            : "PROVIDER_UNAVAILABLE",
    safeMessage:
      status === 401
        ? `Azure authentication failed for ${resource}`
        : status === 403
          ? `Azure authorization denied for ${resource}`
          : status === 404
            ? `Azure ${resource} was not found`
            : `Azure ${resource} request failed`,
    retryable: status === 429 || status === undefined || status >= 500,
    provider: "azure",
    cause: error
  });
}

export function requireNotCancelled(signal: AbortSignal, resource: string): void {
  if (signal.aborted) {
    throw new GateError({
      code: "CANCELLED",
      safeMessage: `Azure ${resource} evidence collection was cancelled`,
      retryable: false,
      provider: "azure",
      cause: signal.reason
    });
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function invalidAzureEvidence(message: string): never {
  throw new GateError({
    code: "EVIDENCE_INVALID",
    safeMessage: message,
    retryable: false,
    provider: "azure"
  });
}
