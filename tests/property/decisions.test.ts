import { aggregateDecision, type GateResult } from "@observability-gate/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const statuses = ["passed", "warned", "failed", "inconclusive", "error", "skipped"] as const;

function gate(index: number, status: (typeof statuses)[number], blocking: boolean): GateResult {
  return {
    id: `gate-${index}`,
    name: `Gate ${index}`,
    type: "property.test",
    phase: "post_deployment",
    enforcement: blocking ? "blocking" : "advisory",
    status,
    startedAt: "2026-10-07T00:00:00.000Z",
    completedAt: "2026-10-07T00:00:00.000Z",
    durationMs: 0,
    assertions: [],
    evidence: [],
    diagnostics: []
  };
}

describe("decision properties", () => {
  it("is independent of gate completion order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...statuses), fc.boolean()), {
          minLength: 1,
          maxLength: 40
        }),
        fc.integer(),
        (definitions, seed) => {
          const gates = definitions.map(([status, blocking], index) =>
            gate(index, status, blocking)
          );
          const shuffled = fc.sample(fc.shuffledSubarray(gates, { minLength: gates.length }), {
            seed,
            numRuns: 1
          })[0];
          const input = {
            configurationOrder: gates.map((item) => item.id),
            policy: { minimumEvidenceCoveragePercent: 0, warnOnSkipped: true },
            evidenceRequirements: []
          } as const;
          const original = aggregateDecision({ ...input, gates });
          const reordered = aggregateDecision({ ...input, gates: shuffled ?? gates });

          expect(reordered.decision).toBe(original.decision);
          expect(reordered.counts).toEqual(original.counts);
          expect(reordered.gates.map((item) => item.id)).toEqual(
            original.gates.map((item) => item.id)
          );
        }
      ),
      { numRuns: 250 }
    );
  });

  it("never passes when a blocking gate is non-pass", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("failed", "warned", "inconclusive", "error" as const),
        (status) => {
          const result = aggregateDecision({
            gates: [gate(0, status, true)],
            policy: { minimumEvidenceCoveragePercent: 0, warnOnSkipped: false },
            evidenceRequirements: []
          });
          expect(result.decision).toBe(
            status === "failed" ? "fail" : status === "error" ? "error" : "inconclusive"
          );
        }
      )
    );
  });
});
