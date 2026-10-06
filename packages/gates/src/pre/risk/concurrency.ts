import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const deploymentConcurrencyGate = createEvidenceGate({
  type: "deployment.concurrency",
  description: "Reject another active deployment for the target.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const deployments = Array.isArray(value.deployments)
      ? (value.deployments as EvidenceRecord[])
      : [];
    const current = value.currentDeploymentId;
    const concurrent = deployments.filter(
      (deployment) => deployment.active === true && deployment.id !== current
    );
    return [
      assertion(
        "deployment concurrency",
        concurrent.length === 0,
        "No other deployment is active for the target",
        concurrent.length,
        0
      )
    ];
  }
});
