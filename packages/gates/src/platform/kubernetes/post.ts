import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../../evaluation.js";

function records(value: unknown): EvidenceRecord[] {
  return Array.isArray(value) ? (value as EvidenceRecord[]) : [];
}

function conditionIs(conditions: EvidenceRecord[], type: string, status: string) {
  return conditions.some((condition) => condition.type === type && condition.status === status);
}

export const kubernetesRolloutStatusGate = createEvidenceGate({
  type: "kubernetes.rollout_status",
  description:
    "Validate Kubernetes observed generation, conditions, replicas, and rollout duration.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const rollout = record(value.rollout) ?? {};
    const replicas = record(rollout.replicas) ?? {};
    const conditions = records(rollout.conditions);
    const desired = typeof replicas.desired === "number" ? replicas.desired : 0;
    return [
      assertion(
        "observed generation",
        rollout.generationObserved === true,
        "Controller observed the intended generation"
      ),
      assertion(
        "progressing condition",
        conditionIs(conditions, "Progressing", "True"),
        "Rollout is progressing"
      ),
      assertion(
        "available condition",
        conditionIs(conditions, "Available", "True"),
        "Workload is available"
      ),
      assertion(
        "updated replicas",
        replicas.updated === desired && desired > 0,
        "Updated replicas equal desired replicas",
        replicas.updated,
        desired
      ),
      assertion(
        "available replicas",
        replicas.available === desired && desired > 0,
        "Available replicas equal desired replicas",
        replicas.available,
        desired
      ),
      assertion(
        "unavailable replicas",
        replicas.unavailable === 0,
        "No replicas are unavailable",
        replicas.unavailable,
        0
      ),
      assertion(
        "rollout duration",
        typeof rollout.durationMs === "number" &&
          typeof rollout.maximumDurationMs === "number" &&
          rollout.durationMs <= rollout.maximumDurationMs,
        "Rollout completed within policy",
        rollout.durationMs,
        rollout.maximumDurationMs
      )
    ];
  }
});

export const kubernetesImageIdentityGate = createEvidenceGate({
  type: "kubernetes.image_identity",
  description: "Compare ready pod imageID digests with the expected release digest.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const expected = value.expectedImageDigest;
    const ready = records(value.pods).filter((pod) => pod.ready === true);
    const mismatches = ready.filter((pod) => pod.imageDigest !== expected);
    return [
      assertion(
        "ready pods",
        ready.length > 0,
        "At least one ready pod reports image identity",
        ready.length
      ),
      assertion(
        "imageID digest",
        typeof expected === "string" && mismatches.length === 0,
        "Every ready pod imageID matches the expected digest",
        mismatches.map((pod) => pod.name),
        expected
      )
    ];
  }
});

export const kubernetesPodHealthGate = createEvidenceGate({
  type: "kubernetes.pod_health",
  description: "Validate Kubernetes pod readiness, restart deltas, states, and probes.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const pods = records(value.pods);
    const ready = pods.filter((pod) => pod.ready === true).length;
    const readyPercent = pods.length > 0 ? (ready / pods.length) * 100 : 0;
    const restartIncrease = pods.reduce(
      (sum, pod) => sum + (typeof pod.restartIncrease === "number" ? pod.restartIncrease : 0),
      0
    );
    const forbiddenWaiting = new Set([
      "CrashLoopBackOff",
      "ImagePullBackOff",
      "ErrImagePull",
      "CreateContainerConfigError"
    ]);
    const forbiddenTerminations = new Set(["OOMKilled", "Error"]);
    const waiting = pods
      .flatMap((pod) => records(pod.waitingReasons).map(String))
      .filter((reason) => forbiddenWaiting.has(reason));
    const terminated = pods
      .flatMap((pod) => records(pod.terminationReasons).map(String))
      .filter((reason) => forbiddenTerminations.has(reason));
    return [
      assertion(
        "ready pods",
        readyPercent === 100,
        "All candidate pods are ready",
        readyPercent,
        100
      ),
      assertion(
        "restart increase",
        restartIncrease === 0,
        "Candidate pod restarts did not increase",
        restartIncrease,
        0
      ),
      assertion(
        "waiting states",
        waiting.length === 0,
        "Pods have no forbidden waiting reasons",
        waiting
      ),
      assertion(
        "termination states",
        terminated.length === 0,
        "Pods have no forbidden termination reasons",
        terminated
      ),
      assertion(
        "probe health",
        pods.length > 0 && pods.every((pod) => pod.probesHealthy === true),
        "Candidate pod probes remain healthy"
      )
    ];
  }
});

export const kubernetesEventsGate = createEvidenceGate({
  type: "kubernetes.events",
  description: "Detect release-window Kubernetes warning events.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const events = records(value.warningEvents);
    const forbidden = new Set(
      Array.isArray(value.forbiddenEventReasons) ? value.forbiddenEventReasons.map(String) : []
    );
    const matching = events.filter((event) => forbidden.has(String(event.reason)));
    const maximum = typeof value.maximumWarningEvents === "number" ? value.maximumWarningEvents : 0;
    return [
      assertion(
        "forbidden warning reasons",
        matching.length === 0,
        "No forbidden warning event occurred during deployment",
        matching.map((event) => event.reason)
      ),
      assertion(
        "warning event count",
        events.length <= maximum,
        "Warning event count is within policy",
        events.length,
        maximum
      )
    ];
  }
});
