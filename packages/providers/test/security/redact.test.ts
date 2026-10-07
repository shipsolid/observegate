import { describe, expect, it } from "vitest";
import { Redactor } from "../../src/index.js";

describe("Redactor", () => {
  it("redacts sensitive keys regardless of case", () => {
    const redactor = new Redactor();
    const result = redactor.redactValue({
      token: "one",
      PASSWORD: "two",
      clientSecret: "three",
      apiKey: "four",
      Cookie: "five",
      Authorization: "Bearer six",
      "set-cookie": "session=seven",
      nested: { access_token: "eight" },
      attempts: 3
    });

    expect(result).toEqual({
      token: "[REDACTED]",
      PASSWORD: "[REDACTED]",
      clientSecret: "[REDACTED]",
      apiKey: "[REDACTED]",
      Cookie: "[REDACTED]",
      Authorization: "[REDACTED]",
      "set-cookie": "[REDACTED]",
      nested: { access_token: "[REDACTED]" },
      attempts: 3
    });
  });

  it("redacts URL query strings and bearer tokens inside diagnostics", () => {
    const redactor = new Redactor();

    expect(
      redactor.redactValue(
        "Request https://api.example.com/query?token=secret&service=checkout failed with Bearer abc.def-123"
      )
    ).toBe("Request https://api.example.com/query?[REDACTED] failed with Bearer [REDACTED]");
  });

  it("preserves non-sensitive field names and numeric remediation values", () => {
    const redactor = new Redactor();

    expect(
      redactor.redactValue({ monkey: "visible", threshold: 95, retryAfterSeconds: 2 })
    ).toEqual({ monkey: "visible", threshold: 95, retryAfterSeconds: 2 });
  });

  it("redacts nested arrays and cycles while preserving queryless and invalid URLs", () => {
    const redactor = new Redactor();
    const cyclic: { name: string; self?: unknown } = { name: "checkout" };
    cyclic.self = cyclic;

    expect(
      redactor.redactValue({
        items: [{ password: "secret" }, "https://api.example.com/health"],
        cyclic,
        invalid: "https://[not-an-ipv6-address]/?token=secret",
        nothing: null
      })
    ).toEqual({
      items: [{ password: "[REDACTED]" }, "https://api.example.com/health"],
      cyclic: { name: "checkout", self: "[REDACTED]" },
      invalid: "https://[not-an-ipv6-address]/?token=secret",
      nothing: null
    });
  });
});
