import { GateError } from "@observability-gate/core";
import type { RuntimeCondition, RuntimeEvent, RuntimeSnapshot } from "../types.js";

export interface KubernetesReplicaStatus {
  readonly desired: number;
  readonly updated: number;
  readonly ready: number;
  readonly available: number;
  readonly unavailable: number;
}

export interface KubernetesPodEvidence {
  readonly name: string;
  readonly uid?: string;
  readonly phase?: string;
  readonly ready: boolean;
  readonly restarts: number;
  readonly images: readonly string[];
  readonly imageDigest?: string;
  readonly waitingReasons: readonly string[];
  readonly terminationReasons: readonly string[];
  readonly oomKilled: boolean;
}

export interface KubernetesSnapshot extends RuntimeSnapshot {
  readonly namespace: string;
  readonly workloadKind: "Deployment" | "StatefulSet" | "DaemonSet";
  readonly workloadName: string;
  readonly rollout: {
    readonly generation: number;
    readonly observedGeneration: number;
    readonly generationObserved: boolean;
    readonly replicas: KubernetesReplicaStatus;
    readonly conditions: readonly RuntimeCondition[];
  };
  readonly replicaSetUids: readonly string[];
  readonly pods: readonly KubernetesPodEvidence[];
  readonly warningEvents: readonly RuntimeEvent[];
}

export interface KubernetesNormalizationInput {
  readonly target?: string;
  readonly workload: unknown;
  readonly replicaSets: readonly unknown[];
  readonly pods: readonly unknown[];
  readonly events: readonly unknown[];
  readonly observedAt: string;
  readonly deploymentStartedAt?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Kubernetes API returned malformed evidence",
      retryable: false
    });
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> {
  return value === undefined ? {} : object(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function ownerUids(metadata: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(metadata.ownerReferences)) return [];
  return metadata.ownerReferences
    .filter(
      (owner): owner is Record<string, unknown> =>
        owner !== null && typeof owner === "object" && !Array.isArray(owner)
    )
    .filter((owner) => owner.controller === true && typeof owner.uid === "string")
    .map((owner) => owner.uid as string);
}

function conditions(value: unknown): readonly RuntimeCondition[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.flatMap((raw) => {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      if (typeof item.type !== "string" || typeof item.status !== "string") return [];
      return [
        Object.freeze({
          type: item.type,
          status: item.status,
          ...(typeof item.reason === "string" ? { reason: item.reason } : {}),
          ...(typeof item.message === "string" ? { message: item.message } : {})
        })
      ];
    })
  );
}

function replicas(
  kind: string,
  spec: Record<string, unknown>,
  status: Record<string, unknown>
): KubernetesReplicaStatus {
  if (kind === "DaemonSet") {
    return Object.freeze({
      desired: count(status.desiredNumberScheduled),
      updated: count(status.updatedNumberScheduled),
      ready: count(status.numberReady),
      available: count(status.numberAvailable),
      unavailable: count(status.numberUnavailable)
    });
  }
  const desired = count(spec.replicas);
  const available = count(status.availableReplicas);
  return Object.freeze({
    desired,
    updated: count(status.updatedReplicas),
    ready: count(status.readyReplicas),
    available,
    unavailable:
      typeof status.unavailableReplicas === "number"
        ? count(status.unavailableReplicas)
        : Math.max(0, desired - available)
  });
}

function podEvidence(value: unknown): KubernetesPodEvidence {
  const pod = object(value);
  const metadata = optionalObject(pod.metadata);
  const status = optionalObject(pod.status);
  const containerStatuses = Array.isArray(status.containerStatuses) ? status.containerStatuses : [];
  const waitingReasons: string[] = [];
  const terminationReasons: string[] = [];
  const images: string[] = [];
  let restarts = 0;
  let imageDigest: string | undefined;
  for (const raw of containerStatuses) {
    const container = object(raw);
    restarts += count(container.restartCount);
    if (typeof container.image === "string") images.push(container.image);
    if (typeof container.imageID === "string") {
      imageDigest ??= container.imageID.match(/@(sha256:[a-f0-9]{64})$/iu)?.[1];
    }
    const state = optionalObject(container.state);
    const waiting = optionalObject(state.waiting);
    const terminated = optionalObject(state.terminated);
    const lastState = optionalObject(container.lastState);
    const lastTerminated = optionalObject(lastState.terminated);
    for (const candidate of [waiting.reason]) {
      if (typeof candidate === "string") waitingReasons.push(candidate);
    }
    for (const candidate of [terminated.reason, lastTerminated.reason]) {
      if (typeof candidate === "string") terminationReasons.push(candidate);
    }
  }
  const ready = Array.isArray(status.conditions)
    ? status.conditions.some(
        (condition) =>
          condition !== null &&
          typeof condition === "object" &&
          !Array.isArray(condition) &&
          (condition as Record<string, unknown>).type === "Ready" &&
          (condition as Record<string, unknown>).status === "True"
      )
    : false;
  return Object.freeze({
    name: typeof metadata.name === "string" ? metadata.name : "unknown",
    ...(typeof metadata.uid === "string" ? { uid: metadata.uid } : {}),
    ...(typeof status.phase === "string" ? { phase: status.phase } : {}),
    ready,
    restarts,
    images: Object.freeze(images),
    ...(imageDigest === undefined ? {} : { imageDigest }),
    waitingReasons: Object.freeze(waitingReasons),
    terminationReasons: Object.freeze(terminationReasons),
    oomKilled: terminationReasons.includes("OOMKilled")
  });
}

export function normalizeKubernetesSnapshot(
  input: KubernetesNormalizationInput
): KubernetesSnapshot {
  const workload = object(input.workload);
  const metadata = object(workload.metadata);
  const spec = optionalObject(workload.spec);
  const status = optionalObject(workload.status);
  const kind = workload.kind;
  if (
    !["Deployment", "StatefulSet", "DaemonSet"].includes(String(kind)) ||
    typeof metadata.name !== "string" ||
    typeof metadata.namespace !== "string" ||
    typeof metadata.uid !== "string"
  ) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Kubernetes workload identity is invalid",
      retryable: false
    });
  }
  const replicaSetUids = input.replicaSets.flatMap((raw) => {
    const replicaSet = object(raw);
    const replicaMetadata = optionalObject(replicaSet.metadata);
    return ownerUids(replicaMetadata).includes(metadata.uid as string) &&
      typeof replicaMetadata.uid === "string"
      ? [replicaMetadata.uid]
      : [];
  });
  const acceptedOwners = new Set([metadata.uid, ...replicaSetUids]);
  const selectedPods = input.pods
    .filter((raw) => {
      const pod = object(raw);
      const podMetadata = optionalObject(pod.metadata);
      const owners = ownerUids(podMetadata);
      return owners.length === 0 || owners.some((uid) => acceptedOwners.has(uid));
    })
    .map(podEvidence);
  const involvedUids = new Set([metadata.uid, ...selectedPods.flatMap((pod) => pod.uid ?? [])]);
  const deploymentStartedAt =
    input.deploymentStartedAt === undefined ? undefined : Date.parse(input.deploymentStartedAt);
  const warningEvents = input.events.flatMap((raw): RuntimeEvent[] => {
    const event = object(raw);
    const involved = optionalObject(event.involvedObject);
    const timestamp =
      typeof event.eventTime === "string"
        ? event.eventTime
        : typeof event.lastTimestamp === "string"
          ? event.lastTimestamp
          : undefined;
    if (
      event.type !== "Warning" ||
      typeof event.reason !== "string" ||
      typeof involved.name !== "string" ||
      (typeof involved.uid === "string" && !involvedUids.has(involved.uid)) ||
      (deploymentStartedAt !== undefined &&
        timestamp !== undefined &&
        Date.parse(timestamp) < deploymentStartedAt)
    )
      return [];
    return [
      Object.freeze({
        type: "Warning",
        reason: event.reason,
        ...(typeof event.message === "string" ? { message: event.message } : {}),
        involvedObject: involved.name,
        ...(timestamp === undefined ? {} : { observedAt: new Date(timestamp).toISOString() })
      })
    ];
  });
  const generation = count(metadata.generation);
  const observedGeneration = count(status.observedGeneration);
  const rolloutConditions = conditions(status.conditions);
  return Object.freeze({
    target: input.target ?? metadata.name,
    runtimeType: "kubernetes",
    observedAt: input.observedAt,
    releaseIdentities: Object.freeze(
      [input.workload, ...input.pods].flatMap((raw) => {
        const resource = object(raw);
        const meta = optionalObject(resource.metadata);
        if (resource !== input.workload && !selectedPods.some((pod) => pod.name === meta.name))
          return [];
        const labels = optionalObject(meta.labels);
        return ["app.kubernetes.io/version", "service.version", "service_version"].flatMap(
          (label) => {
            const releaseId = labels[label];
            return typeof releaseId !== "string" || releaseId.length === 0
              ? []
              : [
                  Object.freeze({
                    source: `kubernetes.label.${label}`,
                    releaseId,
                    ...(typeof meta.uid === "string" ? { instanceId: meta.uid } : {})
                  })
                ];
          }
        );
      })
    ),
    conditions: rolloutConditions,
    events: Object.freeze(warningEvents),
    namespace: metadata.namespace,
    workloadKind: kind as KubernetesSnapshot["workloadKind"],
    workloadName: metadata.name,
    rollout: Object.freeze({
      generation,
      observedGeneration,
      generationObserved: observedGeneration >= generation,
      replicas: replicas(String(kind), spec, status),
      conditions: rolloutConditions
    }),
    replicaSetUids: Object.freeze(replicaSetUids),
    pods: Object.freeze(selectedPods),
    warningEvents: Object.freeze(warningEvents)
  });
}
