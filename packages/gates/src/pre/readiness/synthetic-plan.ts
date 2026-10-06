import { assertion, createEvidenceGate } from "../../evaluation.js";

export const syntheticPlanGate = createEvidenceGate({
  type: "synthetic.plan",
  description: "Validate bounded release verification checks.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    return [
      assertion("plan exists", value.exists === true, "A synthetic release plan exists"),
      assertion(
        "bounded timeout",
        typeof value.timeoutMs === "number" && value.timeoutMs > 0 && value.timeoutMs <= 120_000,
        "Synthetic timeout is bounded",
        value.timeoutMs
      ),
      assertion(
        "success assertion",
        value.successAssertion === true,
        "Synthetic plan asserts success"
      ),
      assertion(
        "release assertion",
        value.releaseAssertion === true,
        "Synthetic plan asserts release identity"
      ),
      assertion(
        "secret-safe output",
        value.logsSecrets !== true,
        "Synthetic output does not expose secrets"
      )
    ];
  }
});
