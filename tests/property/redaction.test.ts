import { Redactor } from "@observability-gate/providers";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("redaction properties", () => {
  it("never preserves values stored under sensitive keys", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Za-z0-9._~+/=-]{8,64}$/u),
        fc.constantFrom("token", "password", "client_secret", "authorization", "api-key"),
        (secret, key) => {
          const redacted = new Redactor().redactValue({
            safe: "visible",
            nested: { [key]: secret },
            diagnostic: `Bearer ${secret}`,
            url: `https://example.com/query?token=${secret}`
          });
          const serialized = JSON.stringify(redacted);

          expect(serialized).not.toContain(secret);
          expect(serialized).toContain("[REDACTED]");
          expect(serialized).toContain("visible");
        }
      ),
      { numRuns: 250 }
    );
  });
});
