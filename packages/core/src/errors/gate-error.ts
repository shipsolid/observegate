import type { Diagnostic } from "../domain/gates.js";
import type { ErrorCode } from "./codes.js";

export interface GateErrorOptions {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly gateId?: string;
  readonly cause?: unknown;
}

export class GateError extends Error {
  public readonly code: ErrorCode;
  public readonly safeMessage: string;
  public readonly retryable: boolean;
  public readonly provider: string | undefined;
  public readonly gateId: string | undefined;
  public override readonly cause: unknown;

  public constructor(options: GateErrorOptions) {
    super(options.safeMessage);
    this.name = "GateError";
    this.code = options.code;
    this.safeMessage = options.safeMessage;
    this.retryable = options.retryable;
    this.provider = options.provider;
    this.gateId = options.gateId;
    this.cause = options.cause;
  }

  public toDiagnostic(): Diagnostic {
    const diagnostic: {
      code: ErrorCode;
      message: string;
      retryable: boolean;
      provider?: string;
      gateId?: string;
    } = {
      code: this.code,
      message: this.safeMessage,
      retryable: this.retryable
    };

    if (this.provider !== undefined) {
      diagnostic.provider = this.provider;
    }
    if (this.gateId !== undefined) {
      diagnostic.gateId = this.gateId;
    }

    return Object.freeze(diagnostic);
  }
}
