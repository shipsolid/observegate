import { GateError } from "@observability-gate/core";
import { parseAllDocuments } from "yaml";

export interface KubernetesManifestSelector {
  readonly kind: "Deployment" | "StatefulSet" | "DaemonSet";
  readonly name: string;
  readonly namespace: string;
  readonly container?: string;
}

export interface KubernetesManifestEvidence {
  readonly document: number;
  readonly workloadKind: KubernetesManifestSelector["kind"];
  readonly containerIndex: number;
  readonly partition?: number;
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

function matchesSelector(
  value: unknown,
  labels: Record<string, unknown>,
  version: unknown
): boolean {
  const selector = record(value);
  if (selector === undefined) return false;
  const matchLabels = record(selector.matchLabels) ?? {};
  if (
    (selector.matchLabels !== undefined && record(selector.matchLabels) === undefined) ||
    Object.values(matchLabels).some((value) => typeof value !== "string") ||
    (selector.matchExpressions !== undefined && !Array.isArray(selector.matchExpressions))
  )
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Pod disruption budget selector is malformed",
      retryable: false
    });
  const expressions = Array.isArray(selector.matchExpressions) ? selector.matchExpressions : [];
  if (Object.keys(matchLabels).length === 0 && expressions.length === 0)
    return version === "policy/v1";
  return (
    Object.entries(matchLabels).every(([key, value]) => labels[key] === value) &&
    expressions.every((raw) => {
      const expression = record(raw);
      if (typeof expression?.key !== "string")
        throw new GateError({
          code: "EVIDENCE_INVALID",
          safeMessage: "Pod disruption budget selector is malformed",
          retryable: false
        });
      const exists = Object.hasOwn(labels, expression.key);
      const values = Array.isArray(expression.values) ? expression.values : [];
      if (
        (["In", "NotIn"].includes(String(expression.operator)) &&
          (values.length === 0 || values.some((value) => typeof value !== "string"))) ||
        (["Exists", "DoesNotExist"].includes(String(expression.operator)) && values.length !== 0)
      )
        throw new GateError({
          code: "EVIDENCE_INVALID",
          safeMessage: "Pod disruption budget selector is malformed",
          retryable: false
        });
      switch (expression.operator) {
        case "In":
          return exists && values.includes(labels[expression.key]);
        case "NotIn":
          return !exists || !values.includes(labels[expression.key]);
        case "Exists":
          return exists;
        case "DoesNotExist":
          return !exists;
        default:
          throw new GateError({
            code: "EVIDENCE_INVALID",
            safeMessage: "Pod disruption budget selector is unsupported",
            retryable: false
          });
      }
    })
  );
}

interface SelectorRequirement {
  readonly key: string;
  readonly operator: string;
  readonly values: readonly unknown[];
}

function requirements(value: unknown): readonly SelectorRequirement[] {
  const selector = record(value);
  return [
    ...Object.entries(record(selector?.matchLabels) ?? {}).map(([key, value]) => ({
      key,
      operator: "In",
      values: [value]
    })),
    ...(Array.isArray(selector?.matchExpressions) ? selector.matchExpressions : []).map((raw) => {
      const expression = record(raw);
      return {
        key: String(expression?.key),
        operator: String(expression?.operator),
        values: Array.isArray(expression?.values) ? expression.values : []
      };
    })
  ];
}

function constrainsWorkloadSelector(budget: unknown, workload: unknown): boolean {
  const target = requirements(workload);
  const candidates = requirements(budget);
  // Prove each controller constraint independently. Unproven implication fails closed.
  return (
    target.length > 0 &&
    target.every((required) =>
      candidates.some((candidate) => {
        if (candidate.key !== required.key) return false;
        if (required.operator === "In")
          return (
            candidate.operator === "In" &&
            candidate.values.length > 0 &&
            candidate.values.every((value) => required.values.includes(value))
          );
        if (required.operator === "Exists")
          return candidate.operator === "Exists" || candidate.operator === "In";
        if (required.operator === "DoesNotExist") return candidate.operator === "DoesNotExist";
        if (required.operator === "NotIn")
          return (
            candidate.operator === "DoesNotExist" ||
            (candidate.operator === "In" &&
              candidate.values.every((value) => !required.values.includes(value))) ||
            (candidate.operator === "NotIn" &&
              required.values.every((value) => candidate.values.includes(value)))
          );
        return false;
      })
    )
  );
}

function podTemplateLabels(resource: Record<string, unknown>): Record<string, unknown> | undefined {
  if (resource.kind === "Pod") return record(record(resource.metadata)?.labels);
  const spec = record(resource.spec);
  const template =
    record(spec?.template) ?? record(record(record(spec?.jobTemplate)?.spec)?.template);
  return record(record(template?.metadata)?.labels);
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
  const selected = containers.flatMap((value, index) => {
    const container = record(value);
    return selector.container === undefined || container?.name === selector.container
      ? [{ container, index }]
      : [];
  });
  const selectedContainer = selected[0];
  if (selected.length !== 1 || selectedContainer === undefined)
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage:
        "Kubernetes container selection is missing or ambiguous; configure workload.container",
      retryable: false
    });
  const container = selectedContainer.container;
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
  const labels = record(record(template?.metadata)?.labels) ?? {};
  const budgets = resources.filter((value) => {
    const item = record(value);
    return (
      item?.kind === "PodDisruptionBudget" &&
      record(item.metadata)?.namespace === selector.namespace &&
      matchesSelector(record(item.spec)?.selector, labels, item.apiVersion)
    );
  });
  if (budgets.length > 1)
    throw new GateError({
      code: "EVIDENCE_INVALID",
      safeMessage: "Multiple pod disruption budgets select the workload",
      retryable: false
    });
  const budgetSpec = record(record(budgets[0])?.spec);
  if (budgetSpec !== undefined) {
    if (!constrainsWorkloadSelector(budgetSpec.selector, spec.selector))
      throw new GateError({
        code: "EVIDENCE_INVALID",
        safeMessage:
          "Pod disruption budget selector is broader than or cannot be proven to constrain the workload selector",
        retryable: false
      });
    const shared = resources.some((raw, index) => {
      const item = record(raw);
      if (index === workloadIndex || item === undefined) return false;
      const namespace = record(item.metadata)?.namespace;
      if (namespace !== undefined && namespace !== selector.namespace) return false;
      const labels = podTemplateLabels(item);
      return (
        labels !== undefined &&
        matchesSelector(budgetSpec.selector, labels, record(budgets[0])?.apiVersion)
      );
    });
    if (shared)
      throw new GateError({
        code: "EVIDENCE_INVALID",
        safeMessage:
          "Pod disruption budget is shared with another rendered workload and cannot prove workload-specific availability",
        retryable: false
      });
  }
  const strategy = record(selector.kind === "Deployment" ? spec.strategy : spec.updateStrategy);
  const rollingUpdate = record(strategy?.rollingUpdate);
  return Object.freeze({
    document: workloadIndex,
    workloadKind: selector.kind,
    containerIndex: selectedContainer.index,
    ...(selector.kind === "StatefulSet"
      ? { partition: typeof rollingUpdate?.partition === "number" ? rollingUpdate.partition : 0 }
      : {}),
    image: container.image,
    namespaceExplicit: typeof record(object.metadata)?.namespace === "string",
    ...(selector.kind === "DaemonSet"
      ? {}
      : { replicas: typeof spec.replicas === "number" ? spec.replicas : 1 }),
    strategy: typeof strategy?.type === "string" ? strategy.type : "RollingUpdate",
    ...(typeof rollingUpdate?.maxUnavailable === "number" ||
    typeof rollingUpdate?.maxUnavailable === "string"
      ? { maxUnavailable: rollingUpdate.maxUnavailable }
      : { maxUnavailable: selector.kind === "Deployment" ? "25%" : 1 }),
    ...(typeof spec.progressDeadlineSeconds === "number"
      ? { progressDeadlineSeconds: spec.progressDeadlineSeconds }
      : {}),
    minimumReadySeconds: typeof spec.minReadySeconds === "number" ? spec.minReadySeconds : 0,
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
