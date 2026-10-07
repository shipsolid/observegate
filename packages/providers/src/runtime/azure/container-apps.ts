import { stableFingerprint, type Evidence } from "@observability-gate/core";
import { asRecord, invalidAzureEvidence, mapAzureError, requireNotCancelled } from "./normalize.js";
import type { RuntimeSnapshot } from "../types.js";

export interface ContainerAppsReadClient {
  getApp(resourceGroup: string, appName: string, signal: AbortSignal): Promise<unknown>;
  listRevisions(
    resourceGroup: string,
    appName: string,
    signal: AbortSignal
  ): AsyncIterable<unknown>;
  listReplicas(
    resourceGroup: string,
    appName: string,
    revisionName: string,
    signal: AbortSignal
  ): Promise<readonly unknown[]>;
}

interface ContainerAppsSdkReadSurface {
  readonly containerApps: {
    get(
      resourceGroup: string,
      appName: string,
      options: { readonly abortSignal: AbortSignal }
    ): Promise<unknown>;
  };
  readonly containerAppsRevisions: {
    listRevisions(
      resourceGroup: string,
      appName: string,
      options: { readonly abortSignal: AbortSignal }
    ): AsyncIterable<unknown>;
  };
  readonly containerAppsRevisionReplicas: {
    listReplicas(
      resourceGroup: string,
      appName: string,
      revisionName: string,
      options: { readonly abortSignal: AbortSignal }
    ): Promise<{ readonly value: readonly unknown[] }>;
  };
}

export class AzureSdkContainerAppsReadClient implements ContainerAppsReadClient {
  readonly #getApp: ContainerAppsSdkReadSurface["containerApps"]["get"];
  readonly #listRevisions: ContainerAppsSdkReadSurface["containerAppsRevisions"]["listRevisions"];
  readonly #listReplicas: ContainerAppsSdkReadSurface["containerAppsRevisionReplicas"]["listReplicas"];

  public constructor(client: ContainerAppsSdkReadSurface) {
    this.#getApp = client.containerApps.get.bind(client.containerApps);
    this.#listRevisions = client.containerAppsRevisions.listRevisions.bind(
      client.containerAppsRevisions
    );
    this.#listReplicas = client.containerAppsRevisionReplicas.listReplicas.bind(
      client.containerAppsRevisionReplicas
    );
  }

  public getApp(resourceGroup: string, appName: string, signal: AbortSignal): Promise<unknown> {
    return this.#getApp(resourceGroup, appName, { abortSignal: signal });
  }

  public async *listRevisions(
    resourceGroup: string,
    appName: string,
    signal: AbortSignal
  ): AsyncIterable<unknown> {
    for await (const revision of this.#listRevisions(resourceGroup, appName, {
      abortSignal: signal
    })) {
      yield revision;
    }
  }

  public async listReplicas(
    resourceGroup: string,
    appName: string,
    revisionName: string,
    signal: AbortSignal
  ): Promise<readonly unknown[]> {
    return (await this.#listReplicas(resourceGroup, appName, revisionName, { abortSignal: signal }))
      .value;
  }
}

export interface ContainerAppSnapshot extends RuntimeSnapshot {
  readonly provisioningState: string;
  readonly revision: {
    readonly name: string;
    readonly suffix: string;
    readonly provisioningState: string;
    readonly runningState: string;
    readonly active: boolean;
    readonly image: string;
    readonly imageDigest?: string;
  };
  readonly replicas: {
    readonly total: number;
    readonly healthy: number;
    readonly failed: number;
    readonly restarts: number;
  };
  readonly traffic: {
    readonly totalWeight: number;
    readonly candidateWeight: number;
    readonly unknownRevisionWeight: number;
  };
}

export interface ContainerAppSnapshotRequest {
  readonly target: string;
  readonly resourceGroup: string;
  readonly appName: string;
  readonly revisionName: string;
  readonly signal: AbortSignal;
}

export class AzureContainerAppsAdapter {
  public constructor(
    private readonly client: ContainerAppsReadClient,
    private readonly clock: () => number = Date.now
  ) {}

  public async getSnapshot(
    request: ContainerAppSnapshotRequest
  ): Promise<Evidence<ContainerAppSnapshot>> {
    requireNotCancelled(request.signal, "Container Apps");
    try {
      const app = asRecord(
        await this.client.getApp(request.resourceGroup, request.appName, request.signal)
      );
      if (app === undefined || typeof app.provisioningState !== "string") {
        return invalidAzureEvidence("Azure Container App evidence is malformed");
      }
      let selectedRevision: Record<string, unknown> | undefined;
      for await (const rawRevision of this.client.listRevisions(
        request.resourceGroup,
        request.appName,
        request.signal
      )) {
        requireNotCancelled(request.signal, "Container Apps");
        const revision = asRecord(rawRevision);
        if (revision?.name === request.revisionName) selectedRevision = revision;
      }
      if (selectedRevision === undefined) {
        return invalidAzureEvidence("Azure Container App revision was not found");
      }
      const replicas = await this.client.listReplicas(
        request.resourceGroup,
        request.appName,
        request.revisionName,
        request.signal
      );
      requireNotCancelled(request.signal, "Container Apps");
      const value = this.normalize(request, app, selectedRevision, replicas);
      const acquiredAt = new Date(this.clock()).toISOString();
      return Object.freeze({
        id: stableFingerprint({
          target: request.target,
          revision: request.revisionName,
          acquiredAt
        }),
        kind: "runtime.azure-container-apps.snapshot",
        state: "valid",
        source: Object.freeze({ provider: "azure", capability: "container-apps.snapshot" }),
        target: request.target,
        acquiredAt,
        observedAt: acquiredAt,
        value,
        diagnostics: Object.freeze([])
      });
    } catch (error) {
      throw mapAzureError(error, "Container App");
    }
  }

  private normalize(
    request: ContainerAppSnapshotRequest,
    app: Record<string, unknown>,
    revision: Record<string, unknown>,
    rawReplicas: readonly unknown[]
  ): ContainerAppSnapshot {
    const template = asRecord(revision.template);
    const containers = Array.isArray(template?.containers) ? template.containers : [];
    const container = asRecord(containers[0]);
    if (
      typeof revision.name !== "string" ||
      typeof revision.provisioningState !== "string" ||
      typeof revision.runningState !== "string" ||
      typeof revision.active !== "boolean" ||
      typeof container?.image !== "string"
    )
      return invalidAzureEvidence("Azure Container App revision evidence is malformed");
    let healthy = 0;
    let failed = 0;
    let restarts = 0;
    for (const raw of rawReplicas) {
      const replica = asRecord(raw);
      const statuses = Array.isArray(replica?.containers) ? replica.containers : [];
      const ready = statuses.length > 0 && statuses.every((item) => asRecord(item)?.ready === true);
      if (ready && replica?.runningState === "Running") healthy += 1;
      else failed += 1;
      restarts += statuses.reduce(
        (sum, item) =>
          sum +
          (typeof asRecord(item)?.restartCount === "number"
            ? (asRecord(item)?.restartCount as number)
            : 0),
        0
      );
    }
    const configuration = asRecord(app.configuration);
    const ingress = asRecord(configuration?.ingress);
    const trafficEntries = Array.isArray(ingress?.traffic) ? ingress.traffic : [];
    const knownRevisions = new Set([revision.name]);
    let totalWeight = 0;
    let candidateWeight = 0;
    let unknownRevisionWeight = 0;
    for (const raw of trafficEntries) {
      const entry = asRecord(raw);
      const weight = typeof entry?.weight === "number" ? entry.weight : 0;
      totalWeight += weight;
      if (entry?.revisionName === request.revisionName) candidateWeight += weight;
      else if (typeof entry?.revisionName === "string" && !knownRevisions.has(entry.revisionName)) {
        unknownRevisionWeight += weight;
      }
    }
    const digest = container.image.match(/@(sha256:[a-f0-9]{64})$/iu)?.[1];
    const suffix = revision.name.startsWith(`${request.appName}--`)
      ? revision.name.slice(request.appName.length + 2)
      : revision.name;
    return Object.freeze({
      target: request.target,
      runtimeType: "azure_container_apps",
      observedAt: new Date(this.clock()).toISOString(),
      releaseIdentities: Object.freeze([]),
      conditions: Object.freeze([]),
      events: Object.freeze([]),
      provisioningState: app.provisioningState as string,
      revision: Object.freeze({
        name: revision.name,
        suffix,
        provisioningState: revision.provisioningState,
        runningState: revision.runningState,
        active: revision.active,
        image: container.image,
        ...(digest === undefined ? {} : { imageDigest: digest })
      }),
      replicas: Object.freeze({ total: rawReplicas.length, healthy, failed, restarts }),
      traffic: Object.freeze({ totalWeight, candidateWeight, unknownRevisionWeight })
    });
  }
}

export interface ContainerAppManifestEvidence {
  readonly image: string;
  readonly revisionMode: string;
  readonly ingressTransport: string;
  readonly ingressPort: number;
  readonly minimumReplicas: number;
  readonly maximumReplicas: number;
  readonly probes: readonly Readonly<Record<string, unknown>>[];
  readonly managedIdentity: string;
  readonly managedEnvironmentId: string;
  readonly otelEnvironment: Readonly<Record<string, string>>;
}

export function parseContainerAppManifest(content: string): ContainerAppManifestEvidence {
  let root: Record<string, unknown> | undefined;
  try {
    root = asRecord(JSON.parse(content) as unknown);
  } catch {
    root = undefined;
  }
  const properties = asRecord(root?.properties);
  const configuration = asRecord(properties?.configuration);
  const ingress = asRecord(configuration?.ingress);
  const template = asRecord(properties?.template);
  const scale = asRecord(template?.scale);
  const containers = Array.isArray(template?.containers) ? template.containers : [];
  const container = asRecord(containers[0]);
  const identity = asRecord(root?.identity);
  if (
    typeof container?.image !== "string" ||
    typeof configuration?.activeRevisionsMode !== "string" ||
    typeof ingress?.transport !== "string" ||
    typeof ingress.targetPort !== "number" ||
    typeof scale?.minReplicas !== "number" ||
    typeof scale.maxReplicas !== "number" ||
    typeof identity?.type !== "string" ||
    typeof properties?.managedEnvironmentId !== "string"
  )
    return invalidAzureEvidence("Rendered Container App configuration is malformed");
  const probes = Array.isArray(container.probes)
    ? container.probes.filter(
        (probe): probe is Record<string, unknown> => asRecord(probe) !== undefined
      )
    : [];
  const environment = Array.isArray(container.env) ? container.env : [];
  const otelEnvironment = Object.fromEntries(
    environment.flatMap((raw): [string, string][] => {
      const variable = asRecord(raw);
      return typeof variable?.name === "string" &&
        variable.name.startsWith("OTEL_") &&
        typeof variable.value === "string"
        ? [[variable.name, variable.value]]
        : [];
    })
  );
  return Object.freeze({
    image: container.image,
    revisionMode: configuration.activeRevisionsMode,
    ingressTransport: ingress.transport,
    ingressPort: ingress.targetPort,
    minimumReplicas: scale.minReplicas,
    maximumReplicas: scale.maxReplicas,
    probes: Object.freeze(probes.map((probe) => Object.freeze({ ...probe }))),
    managedIdentity: identity.type,
    managedEnvironmentId: properties.managedEnvironmentId,
    otelEnvironment: Object.freeze(otelEnvironment)
  });
}
