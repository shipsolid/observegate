import { describe, expect, it } from "vitest";
import { GateError } from "../../src/errors/gate-error.js";

describe("GateError", () => {
  it("serializes only safe diagnostic fields", () => {
    const error = new GateError({
      code: "AUTHENTICATION",
      safeMessage: "The metrics provider rejected authentication.",
      retryable: false,
      provider: "prometheus-primary",
      gateId: "risk.current-health",
      cause: new Error("Authorization: Bearer secret-token")
    });

    const serialized = JSON.stringify(error.toDiagnostic());

    expect(serialized).toContain("AUTHENTICATION");
    expect(serialized).toContain("prometheus-primary");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("cause");
  });
});
