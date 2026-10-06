import { assertion, createEvidenceGate, type EvidenceRecord } from "../evaluation.js";

export const syntheticResultGate = createEvidenceGate({
  type: "synthetic.result",
  description: "Require named release synthetic tests to pass within duration and identity bounds.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const tests = Array.isArray(value.tests) ? (value.tests as EvidenceRecord[]) : [];
    const required = Array.isArray(value.requiredTests) ? value.requiredTests.map(String) : [];
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
            typeof test.maximumDurationMs === "number" &&
            test.durationMs <= test.maximumDurationMs,
          "Synthetic duration is within policy",
          test?.durationMs,
          test?.maximumDurationMs
        ),
        assertion(
          `${name} release identity`,
          typeof test?.releaseHeader === "string" &&
            test.releaseHeader === test.expectedReleaseHeader,
          "Synthetic response identifies the candidate release"
        )
      ];
    });
  }
});
