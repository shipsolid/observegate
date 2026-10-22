import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../evaluation.js";

export const syntheticResultGate = createEvidenceGate({
  type: "synthetic.result",
  description: "Require named release synthetic tests to pass within duration and identity bounds.",
  phases: ["post_deployment"],
  evaluate(definition, value) {
    const tests = Array.isArray(value.tests) ? (value.tests as EvidenceRecord[]) : [];
    const rules = record(definition.assertions) ?? {};
    const requiredTests = rules.required_tests ?? value.requiredTests;
    const required = Array.isArray(requiredTests) ? requiredTests.map(String) : [];
    if (
      required.length === 0 ||
      required.some((name) => name.length === 0) ||
      new Set(required).size !== required.length
    ) {
      return [
        assertion("required tests", false, "A nonempty distinct set of synthetic tests is required")
      ];
    }
    const names = tests.map((test) => String(test.name));
    if (new Set(names).size !== names.length)
      return [assertion("unique tests", false, "Synthetic test names must be unique")];
    const byName = new Map(tests.map((test) => [String(test.name), test]));
    return required.flatMap((name) => {
      const test = byName.get(name);
      return [
        assertion(
          `${name} exists`,
          test !== undefined,
          "Required synthetic test result is present"
        ),
        assertion(`${name} passed`, test?.passed === true, "Synthetic test passed"),
        assertion(
          `${name} duration`,
          typeof test?.durationMs === "number" &&
            Number.isFinite(test.durationMs) &&
            test.durationMs >= 0 &&
            typeof test.maximumDurationMs === "number" &&
            Number.isFinite(test.maximumDurationMs) &&
            test.maximumDurationMs >= 0 &&
            test.durationMs <= test.maximumDurationMs,
          "Synthetic duration is within policy",
          test?.durationMs,
          test?.maximumDurationMs
        ),
        assertion(
          `${name} release identity`,
          typeof test?.releaseHeader === "string" &&
            test.releaseHeader.length > 0 &&
            test.releaseHeader === test.expectedReleaseHeader,
          "Synthetic response identifies the candidate release"
        )
      ];
    });
  }
});
