import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  Observable,
  type ConfigurationOptions,
  type V1DaemonSet,
  type V1Deployment,
  type V1StatefulSet
} from "@kubernetes/client-node";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { GateError } from "@observability-gate/core";

export type KubernetesWorkloadKind = "Deployment" | "StatefulSet" | "DaemonSet";

export interface KubernetesPageRequest {
  readonly signal?: AbortSignal;
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
    readonly signal?: AbortSignal;
    readonly namespace: string;
    readonly kind: KubernetesWorkloadKind;
    readonly name: string;
  }): Promise<unknown>;
  listReplicaSets(request: KubernetesPageRequest): Promise<KubernetesPage>;
  listPods(request: KubernetesPageRequest): Promise<KubernetesPage>;
  listEvents(request: KubernetesPageRequest): Promise<KubernetesPage>;
}

function cancellationOptions(signal?: AbortSignal): ConfigurationOptions {
  return {
    middleware: [
      {
        pre: (context) => {
          if (signal !== undefined) context.setSignal(signal);
          return new Observable(Promise.resolve(context));
        },
        post: (context) => new Observable(Promise.resolve(context))
      }
    ],
    middlewareMergeStrategy: "append"
  };
}

class KubernetesApiReadClient implements KubernetesReadClient {
  public constructor(
    private readonly apps: AppsV1Api,
    private readonly core: CoreV1Api
  ) {}

  public readWorkload(request: {
    readonly signal?: AbortSignal;
    readonly namespace: string;
    readonly kind: KubernetesWorkloadKind;
    readonly name: string;
  }): Promise<V1Deployment | V1StatefulSet | V1DaemonSet> {
    if (request.kind === "Deployment") {
      return this.apps.readNamespacedDeployment(
        {
          name: request.name,
          namespace: request.namespace
        },
        cancellationOptions(request.signal)
      );
    }
    if (request.kind === "StatefulSet") {
      return this.apps.readNamespacedStatefulSet(
        {
          name: request.name,
          namespace: request.namespace
        },
        cancellationOptions(request.signal)
      );
    }
    return this.apps.readNamespacedDaemonSet(
      { name: request.name, namespace: request.namespace },
      cancellationOptions(request.signal)
    );
  }

  public async listReplicaSets(request: KubernetesPageRequest): Promise<KubernetesPage> {
    const response = await this.apps.listNamespacedReplicaSet(
      {
        namespace: request.namespace,
        ...(request.labelSelector === undefined ? {} : { labelSelector: request.labelSelector }),
        limit: request.limit,
        ...(request.continueToken === undefined ? {} : { _continue: request.continueToken })
      },
      cancellationOptions(request.signal)
    );
    return {
      items: response.items,
      ...(response.metadata?._continue === undefined
        ? {}
        : { continueToken: response.metadata._continue })
    };
  }

  public async listPods(request: KubernetesPageRequest): Promise<KubernetesPage> {
    const response = await this.core.listNamespacedPod(
      {
        namespace: request.namespace,
        ...(request.labelSelector === undefined ? {} : { labelSelector: request.labelSelector }),
        limit: request.limit,
        ...(request.continueToken === undefined ? {} : { _continue: request.continueToken })
      },
      cancellationOptions(request.signal)
    );
    return {
      items: response.items,
      ...(response.metadata?._continue === undefined
        ? {}
        : { continueToken: response.metadata._continue })
    };
  }

  public async listEvents(request: KubernetesPageRequest): Promise<KubernetesPage> {
    const response = await this.core.listNamespacedEvent(
      {
        namespace: request.namespace,
        ...(request.fieldSelector === undefined ? {} : { fieldSelector: request.fieldSelector }),
        limit: request.limit,
        ...(request.continueToken === undefined ? {} : { _continue: request.continueToken })
      },
      cancellationOptions(request.signal)
    );
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
    readonly kubeconfigPath?: string;
  } = {}
): KubernetesReadClient {
  const kubeConfig = options.kubeConfig ?? new KubeConfig();
  if (options.kubeConfig === undefined) {
    const paths = (
      options.kubeconfigPath ??
      process.env.KUBECONFIG ??
      join(homedir(), ".kube", "config")
    )
      .split(delimiter)
      .filter(Boolean);
    if (paths.length !== 1)
      throw new GateError({
        code: "CONFIG_REFERENCE",
        safeMessage: "Select one kubeconfig file; merged credential sources are not supported.",
        retryable: false
      });
    const path = paths[0];
    if (path !== undefined && existsSync(path)) kubeConfig.loadFromFile(path);
    else if (process.env.KUBERNETES_SERVICE_HOST !== undefined) kubeConfig.loadFromCluster();
    else
      throw new GateError({
        code: "CONFIG_REFERENCE",
        safeMessage: "A kubeconfig or in-cluster service account is required.",
        retryable: false
      });
  }
  if (options.context !== undefined) kubeConfig.setCurrentContext(options.context);
  if (kubeConfig.getCurrentCluster?.()?.skipTLSVerify === true) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "Kubernetes TLS certificate verification must remain enabled.",
      retryable: false
    });
  }
  const user = kubeConfig.getCurrentUser?.();
  if (user?.exec !== undefined || ["azure", "gcp"].includes(String(user?.authProvider?.name))) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage:
        "Command-based Kubernetes authentication is forbidden; use a token, client certificate, or in-cluster service account.",
      retryable: false
    });
  }
  return new KubernetesApiReadClient(
    kubeConfig.makeApiClient(AppsV1Api),
    kubeConfig.makeApiClient(CoreV1Api)
  );
}
