import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  type V1DaemonSet,
  type V1Deployment,
  type V1StatefulSet
} from "@kubernetes/client-node";

export type KubernetesWorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

export interface KubernetesPageRequest {
  readonly namespace: string;
  readonly labelSelector?: string;
  readonly fieldSelector?: string;
  readonly continueToken?: string;
  readonly limit: number;
}

export interface KubernetesPage {
  readonly items: readonly unknown[];
  readonly continueToken?: string;
}

export interface KubernetesReadClient {
  readWorkload(request: {
    readonly namespace: string;
    readonly kind: KubernetesWorkloadKind;
    readonly name: string;
  }): Promise<unknown>;
  listReplicaSets(request: KubernetesPageRequest): Promise<KubernetesPage>;
  listPods(request: KubernetesPageRequest): Promise<KubernetesPage>;
  listEvents(request: KubernetesPageRequest): Promise<KubernetesPage>;
}

class KubernetesApiReadClient implements KubernetesReadClient {
  public constructor(
    private readonly apps: AppsV1Api,
    private readonly core: CoreV1Api
  ) {}

  public readWorkload(request: {
    readonly namespace: string;
    readonly kind: KubernetesWorkloadKind;
    readonly name: string;
  }): Promise<V1Deployment | V1StatefulSet | V1DaemonSet> {
    if (request.kind === "Deployment") {
      return this.apps.readNamespacedDeployment({
        name: request.name,
        namespace: request.namespace
      });
    }
    if (request.kind === "StatefulSet") {
      return this.apps.readNamespacedStatefulSet({
        name: request.name,
        namespace: request.namespace
      });
    }
    return this.apps.readNamespacedDaemonSet({ name: request.name, namespace: request.namespace });
  }

  public async listReplicaSets(request: KubernetesPageRequest): Promise<KubernetesPage> {
    const response = await this.apps.listNamespacedReplicaSet({
      namespace: request.namespace,
      ...(request.labelSelector === undefined ? {} : { labelSelector: request.labelSelector }),
      limit: request.limit,
      ...(request.continueToken === undefined ? {} : { _continue: request.continueToken })
    });
    return {
      items: response.items,
      ...(response.metadata?._continue === undefined
        ? {}
        : { continueToken: response.metadata._continue })
    };
  }

  public async listPods(request: KubernetesPageRequest): Promise<KubernetesPage> {
    const response = await this.core.listNamespacedPod({
      namespace: request.namespace,
      ...(request.labelSelector === undefined ? {} : { labelSelector: request.labelSelector }),
      limit: request.limit,
      ...(request.continueToken === undefined ? {} : { _continue: request.continueToken })
    });
    return {
      items: response.items,
      ...(response.metadata?._continue === undefined
        ? {}
        : { continueToken: response.metadata._continue })
    };
  }

  public async listEvents(request: KubernetesPageRequest): Promise<KubernetesPage> {
    const response = await this.core.listNamespacedEvent({
      namespace: request.namespace,
      ...(request.fieldSelector === undefined ? {} : { fieldSelector: request.fieldSelector }),
      limit: request.limit,
      ...(request.continueToken === undefined ? {} : { _continue: request.continueToken })
    });
    return {
      items: response.items,
      ...(response.metadata?._continue === undefined
        ? {}
        : { continueToken: response.metadata._continue })
    };
  }
}

export function buildKubernetesReadClient(
  options: {
    readonly kubeConfig?: KubeConfig;
    readonly context?: string;
  } = {}
): KubernetesReadClient {
  const kubeConfig = options.kubeConfig ?? new KubeConfig();
  if (options.kubeConfig === undefined) kubeConfig.loadFromDefault();
  if (options.context !== undefined) kubeConfig.setCurrentContext(options.context);
  return new KubernetesApiReadClient(
    kubeConfig.makeApiClient(AppsV1Api),
    kubeConfig.makeApiClient(CoreV1Api)
  );
}
