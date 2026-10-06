import { describe, expect, it } from "vitest";
import { createGateResult } from "../../src/domain/gates.js";

describe("createGateResult", () => {
  it("freezes the gate result and result-owned collections", () => {
    const result = createGateResult({
      id: "release.error-rate",
      name: "Candidate error rate",
      type: "metric.threshold",
      phase: "post_deployment",
      enforcement: "blocking",
      status: "passed",
      startedAt: "2026-09-24T00:00:00.000Z",
      completedAt: "2026-09-24T00:00:01.000Z",
      durationMs: 1000,
      assertions: [],
      evidence: [],
      diagnostics: []
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assertions)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
  });
});
