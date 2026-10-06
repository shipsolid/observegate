import { GateError } from "@observability-gate/core";
import { parseAllDocuments } from "yaml";

export interface KubernetesManifestSelector {
  readonly kind: "Deployment" | "StatefulSet" | "DaemonSet";
  readonly name: string;
  readonly namespace: string;
}

export interface KubernetesManifestEvidence {
  readonly document: number;
  readonly image: string;
  readonly namespaceExplicit: boolean;
  readonly replicas?: number;
  readonly strategy?: string;
  readonly maxUnavailable?: number | string;
  readonly progressDeadlineSeconds?: number;
  readonly minimumReadySeconds?: number;
  readonly podSecurityContext: Readonly<Record<string, unknown>>;
  readonly containerSecurityContext: Readonly<Record<string, unknown>>;
  readonly readinessProbe?: Readonly<Record<string, unknown>>;
  readonly livenessProbe?: Readonly<Record<string, unknown>>;
  readonly startupProbe?: Readonly<Record<string, unknown>>;
  readonly resources: Readonly<Record<string, unknown>>;
  readonly disruptionBudget?: Readonly<Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseKubernetesManifest(
  content: string,
  selector: KubernetesManifestSelector
): KubernetesManifestEvidence {
  const documents = parseAllDocuments(content, { uniqueKeys: true });
  if (documents.some((document) => document.errors.length > 0)) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Kubernetes manifest YAML is invalid",
      retryable: false
    });
  }
  const resources = documents.map((document) => document.toJS({ maxAliasCount: 0 }) as unknown);
  const workloadIndex = resources.findIndex((value) => {
    const item = record(value);
    const metadata = record(item?.metadata);
    return (
      item?.kind === selector.kind &&
      metadata?.name === selector.name &&
      metadata.namespace === selector.namespace
    );
  });
  const workload = resources[workloadIndex];
  const object = record(workload);
  const spec = record(object?.spec);
  const template = record(spec?.template);
  const podSpec = record(template?.spec);
  const containers = Array.isArray(podSpec?.containers) ? podSpec.containers : [];
  const container = record(containers[0]);
  if (
    object === undefined ||
    spec === undefined ||
    podSpec === undefined ||
    container === undefined ||
    typeof container.image !== "string"
  ) {
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Selected Kubernetes workload manifest is incomplete",
      retryable: false
    });
  }
  const budget = resources.find((value) => {
    const item = record(value);
    const metadata = record(item?.metadata);
    return item?.kind === "PodDisruptionBudget" && metadata?.namespace === selector.namespace;
  });
  const budgetSpec = record(record(budget)?.spec);
  const strategy = record(spec.strategy);
  const rollingUpdate = record(strategy?.rollingUpdate);
  return Object.freeze({
    document: workloadIndex,
    image: container.image,
    namespaceExplicit: typeof record(object.metadata)?.namespace === "string",
    ...(typeof spec.replicas === "number" ? { replicas: spec.replicas } : {}),
    ...(typeof strategy?.type === "string" ? { strategy: strategy.type } : {}),
    ...(typeof rollingUpdate?.maxUnavailable === "number" ||
    typeof rollingUpdate?.maxUnavailable === "string"
      ? { maxUnavailable: rollingUpdate.maxUnavailable }
      : {}),
    ...(typeof spec.progressDeadlineSeconds === "number"
      ? { progressDeadlineSeconds: spec.progressDeadlineSeconds }
      : {}),
    ...(typeof spec.minReadySeconds === "number"
      ? { minimumReadySeconds: spec.minReadySeconds }
      : {}),
    podSecurityContext: Object.freeze({ ...(record(podSpec.securityContext) ?? {}) }),
    containerSecurityContext: Object.freeze({ ...(record(container.securityContext) ?? {}) }),
    ...(record(container.readinessProbe) === undefined
      ? {}
      : { readinessProbe: Object.freeze({ ...record(container.readinessProbe) }) }),
    ...(record(container.livenessProbe) === undefined
      ? {}
      : { livenessProbe: Object.freeze({ ...record(container.livenessProbe) }) }),
    ...(record(container.startupProbe) === undefined
      ? {}
      : { startupProbe: Object.freeze({ ...record(container.startupProbe) }) }),
    resources: Object.freeze({ ...(record(container.resources) ?? {}) }),
    ...(budgetSpec === undefined ? {} : { disruptionBudget: Object.freeze({ ...budgetSpec }) })
  });
}
