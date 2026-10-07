import { Redactor } from "@observability-gate/providers";
import { describe, expect, it } from "vitest";

describe("reporting redaction boundary", () => {
  it("removes secret-shaped keys, bearer values, and URL query strings recursively", () => {
    const secret = "do-not-emit-this-value";
    const output = new Redactor().redactValue({
      diagnostics: [
        {
          authorization: `Bearer ${secret}`,
          message: `GET https://api.example.com/query?access_token=${secret} failed with Bearer ${secret}`,
          nested: { client_secret: secret, safe: "visible" }
        }
      ]
    });
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("visible");
  });
});
