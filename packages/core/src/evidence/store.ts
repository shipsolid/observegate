import { GateError } from "../errors/gate-error.js";
import { fingerprintEvidenceRequest, fingerprintQuery } from "./fingerprint.js";
import type { Evidence, EvidenceLoader, EvidenceRequest } from "./types.js";

export class EvidenceStore {
  private readonly cache = new Map<string, Promise<Evidence<unknown>>>();

  public constructor(private readonly clock: () => Date = () => new Date()) {}

  public getOrLoad<T>(
    request: EvidenceRequest<T>,
    loader: EvidenceLoader<T>
  ): Promise<Evidence<T>> {
    const fingerprint = fingerprintEvidenceRequest(request);
    const cached = this.cache.get(fingerprint);
    if (cached !== undefined) {
      return cached as Promise<Evidence<T>>;
    }

    const pending = Promise.resolve()
      .then(loader)
      .catch((error: unknown) => {
        this.cache.delete(fingerprint);
        const diagnostic =
          error instanceof GateError
            ? error.toDiagnostic()
            : {
                code: "PROVIDER_UNAVAILABLE",
                message: "Evidence acquisition failed.",
                retryable: true,
                provider: request.provider
              };
        const unavailable: Evidence<T> = Object.freeze({
          id: fingerprint,
          kind: request.kind,
          state: "unavailable",
          source: Object.freeze({
            provider: request.provider,
            capability: request.capability,
            ...(request.query === undefined
              ? {}
              : { queryFingerprint: fingerprintQuery(request.query) })
          }),
          target: request.target,
          ...(request.releaseId === undefined ? {} : { releaseId: request.releaseId }),
          acquiredAt: this.clock().toISOString(),
          diagnostics: Object.freeze([diagnostic])
        });
        return unavailable;
      });

    this.cache.set(fingerprint, pending as Promise<Evidence<unknown>>);
    return pending;
  }
}
