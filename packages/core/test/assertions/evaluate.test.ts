import { describe, expect, it } from "vitest";
import { evaluateAssertion, type AssertionDefinition } from "../../src/index.js";

describe("evaluateAssertion", () => {
  it.each([
    {
      definition: { type: "less_than", expected: 10 } as const,
      observed: 10,
      status: "failed"
    },
    {
      definition: { type: "less_than_or_equal", expected: 10 } as const,
      observed: 10,
      status: "passed"
    },
    {
      definition: { type: "greater_than", expected: 10 } as const,
      observed: 11,
      status: "passed"
    },
    {
      definition: { type: "greater_than_or_equal", expected: 10 } as const,
      observed: 9,
      status: "failed"
    }
  ])("evaluates $definition.type boundaries", ({ definition, observed, status }) => {
    expect(evaluateAssertion(definition, observed).status).toBe(status);
  });

  it("compares compatible duration units exactly", () => {
    const result = evaluateAssertion(
      { type: "less_than_or_equal", expected: 0.75, unit: "seconds" },
      { value: 750, unit: "milliseconds" }
    );

    expect(result.status).toBe("passed");
    expect(result.unit).toBe("milliseconds");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "returns EVIDENCE_INVALID for non-finite observations",
    (observed) => {
      const result = evaluateAssertion(
        { type: "greater_than", expected: 0, unit: "count" },
        { value: observed, unit: "count" }
      );

      expect(result.status).toBe("error");
      expect(result.diagnostic?.code).toBe("EVIDENCE_INVALID");
    }
  );

  it("does not silently mix percent and ratio", () => {
    const result = evaluateAssertion(
      { type: "greater_than_or_equal", expected: 99, unit: "percent" },
      { value: 0.99, unit: "ratio" }
    );

    expect(result.status).toBe("error");
    expect(result.diagnostic?.code).toBe("EVIDENCE_INVALID");
  });

  it("returns EVIDENCE_INVALID for non-numeric and untyped numeric evidence", () => {
    expect(evaluateAssertion({ type: "greater_than", expected: 0 }, "one").status).toBe("error");
    expect(
      evaluateAssertion({ type: "greater_than", expected: 1, unit: "seconds" }, 2000).status
    ).toBe("error");
  });

  it("distinguishes an empty array from an absent value", () => {
    expect(evaluateAssertion({ type: "present" }, []).status).toBe("passed");
    expect(evaluateAssertion({ type: "absent" }, []).status).toBe("failed");
    expect(evaluateAssertion({ type: "absent" }, undefined).status).toBe("passed");
    expect(evaluateAssertion({ type: "count", operator: "equals", expected: 0 }, []).status).toBe(
      "passed"
    );
    expect(evaluateAssertion({ type: "present" }, undefined).status).toBe("failed");
  });

  it.each([
    { type: "equals", expected: "ready", observed: "ready", status: "passed" },
    { type: "not_equals", expected: "failed", observed: "ready", status: "passed" },
    {
      type: "allowed_values",
      expected: ["ready", "progressing"],
      observed: "ready",
      status: "passed"
    },
    {
      type: "forbidden_values",
      expected: ["failed", "unknown"],
      observed: "ready",
      status: "passed"
    }
  ] as const)("evaluates $type", ({ type, expected, observed, status }) => {
    const definition = { type, expected } as AssertionDefinition;
    expect(evaluateAssertion(definition, observed).status).toBe(status);
  });

  it.each([
    { type: "equals", expected: "ready", observed: "failed" },
    { type: "not_equals", expected: "ready", observed: "ready" },
    { type: "allowed_values", expected: ["ready"], observed: "failed" },
    { type: "forbidden_values", expected: ["failed"], observed: "failed" }
  ] as const)("reports a failed $type assertion", ({ type, expected, observed }) => {
    const definition = { type, expected, label: "explicit-label" } as AssertionDefinition;
    const result = evaluateAssertion(definition, observed);

    expect(result.status).toBe("failed");
    expect(result.assertion).toBe("explicit-label");
  });

  it.each([
    { operator: "not_equals", expected: 3, observed: "test", status: "passed" },
    { operator: "greater_than", expected: 1, observed: new Set([1, 2]), status: "passed" },
    {
      operator: "greater_than_or_equal",
      expected: 2,
      observed: new Map([
        ["a", 1],
        ["b", 2]
      ]),
      status: "passed"
    },
    { operator: "less_than", expected: 3, observed: 2, status: "passed" },
    { operator: "less_than_or_equal", expected: 2, observed: 3, status: "failed" }
  ] as const)("evaluates count $operator", ({ operator, expected, observed, status }) => {
    expect(evaluateAssertion({ type: "count", operator, expected }, observed).status).toBe(status);
  });

  it("returns EVIDENCE_INVALID when a count cannot be derived", () => {
    const result = evaluateAssertion(
      { type: "count", operator: "equals", expected: 1 },
      { value: "not-a-count" }
    );

    expect(result.status).toBe("error");
    expect(result.diagnostic?.code).toBe("EVIDENCE_INVALID");
  });

  it("evaluates freshness in milliseconds", () => {
    expect(evaluateAssertion({ type: "freshness", maximumAgeMs: 30_000 }, 30_000).status).toBe(
      "passed"
    );
    expect(evaluateAssertion({ type: "freshness", maximumAgeMs: 30_000 }, 30_001).status).toBe(
      "failed"
    );
  });

  it("preserves child results for all and any", () => {
    const children: readonly AssertionDefinition[] = [
      { type: "greater_than", expected: 0 },
      { type: "less_than", expected: 10 }
    ];

    const all = evaluateAssertion({ type: "all", assertions: children }, 5);
    const any = evaluateAssertion({ type: "any", assertions: children }, 12);

    expect(all.status).toBe("passed");
    expect(all.children?.map((child) => child.status)).toEqual(["passed", "passed"]);
    expect(any.status).toBe("passed");
    expect(any.children?.map((child) => child.status)).toEqual(["passed", "failed"]);
  });

  it("propagates failed and invalid composite children", () => {
    const failedChildren: readonly AssertionDefinition[] = [
      { type: "greater_than", expected: 10 },
      { type: "less_than", expected: 0 }
    ];
    const invalidChildren: readonly AssertionDefinition[] = [
      { type: "greater_than", expected: 0 },
      { type: "equals", expected: "bad" }
    ];

    expect(evaluateAssertion({ type: "all", assertions: failedChildren }, 5).status).toBe("failed");
    expect(evaluateAssertion({ type: "any", assertions: failedChildren }, 5).status).toBe("failed");
    expect(evaluateAssertion({ type: "all", assertions: invalidChildren }, "bad").status).toBe(
      "error"
    );
    expect(evaluateAssertion({ type: "any", assertions: invalidChildren }, "bad").status).toBe(
      "passed"
    );
    expect(
      evaluateAssertion(
        {
          type: "any",
          assertions: [{ type: "greater_than", expected: 0 }]
        },
        "bad"
      ).status
    ).toBe("error");
  });

  it("reports required and observed counts for minimum_passing", () => {
    const result = evaluateAssertion(
      {
        type: "minimum_passing",
        minimum: 2,
        assertions: [
          { type: "greater_than", expected: 0 },
          { type: "less_than", expected: 10 },
          { type: "equals", expected: 5 }
        ]
      },
      12
    );

    expect(result.status).toBe("failed");
    expect(result.requiredPassCount).toBe(2);
    expect(result.observedPassCount).toBe(1);
  });

  it("passes minimum_passing and reports invalid children when the minimum is unmet", () => {
    const passing = evaluateAssertion(
      {
        type: "minimum_passing",
        minimum: 1,
        assertions: [{ type: "equals", expected: 5 }]
      },
      5
    );
    const invalid = evaluateAssertion(
      {
        type: "minimum_passing",
        minimum: 1,
        assertions: [{ type: "greater_than", expected: 5 }]
      },
      "bad"
    );

    expect(passing.status).toBe("passed");
    expect(invalid.status).toBe("error");
  });

  it("rejects an unsupported runtime assertion discriminator", () => {
    expect(() =>
      evaluateAssertion({ type: "unsupported" } as unknown as AssertionDefinition, 1)
    ).toThrowError("Unsupported assertion");
  });
});
