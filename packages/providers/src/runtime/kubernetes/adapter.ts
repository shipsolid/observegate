import { withCancellation } from "../../transport/retry.js";
import { GateError, stableFingerprint, type Evidence } from "@observability-gate/core";
import type { RuntimeAdapter } from "../types.js";
import type {
  KubernetesPage,
  KubernetesPageRequest,
  KubernetesReadClient,
  KubernetesWorkloadKind
} from "./client.js";
import { normalizeKubernetesSnapshot, type KubernetesSnapshot } from "./normalize.js";

export interface KubernetesSnapshotRequest {
  readonly target: string;
  readonly namespace: string;
  readonly kind: KubernetesWorkloadKind;
  readonly name: string;
  readonly deploymentStartedAt: string;
  readonly signal: AbortSignal;
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GateError({
      code: "CANCELLED",
      safeMessage: "Kubernetes evidence collection was cancelled",
      retryable: false,
      cause: signal.reason
    });
  }
}

function statusCode(error: unknown): number | undefined {
  if (error !== null && typeof error === "object") {
    const value = error as {
      statusCode?: unknown;
      response?: { statusCode?: unknown; status?: unknown };
    };
    const candidate = value.statusCode ?? value.response?.statusCode ?? value.response?.status;
    return typeof candidate === "number" ? candidate : undefined;
  }
  return undefined;
}

export class KubernetesRuntimeAdapter implements RuntimeAdapter<
  KubernetesSnapshotRequest,
  KubernetesSnapshot
> {
  public constructor(
    private readonly client: KubernetesReadClient,
    private readonly clock: () => number = Date.now
  ) {}

  public async getSnapshot(
    request: KubernetesSnapshotRequest
  ): Promise<Evidence<KubernetesSnapshot>> {
    cancelled(request.signal);
    try {
      const workload = await withCancellation(
        () => this.client.readWorkload(request),
        request.signal
      );
      cancelled(request.signal);
      const selector = this.selectorFor(workload);
      const replicaSets =
        request.kind === "Deployment"
          ? await this.allPages(
              this.client.listReplicaSets.bind(this.client),
              {
                namespace: request.namespace,
                ...(selector === undefined ? {} : { labelSelector: selector }),
                limit: 100
              },
              request.signal
            )
          : [];
      const pods = await this.allPages(
        this.client.listPods.bind(this.client),
        {
          namespace: request.namespace,
          ...(selector === undefined ? {} : { labelSelector: selector }),
          limit: 100
        },
        request.signal
      );
      const events = await this.allPages(
        this.client.listEvents.bind(this.client),
        {
          namespace: request.namespace,
          limit: 100
        },
        request.signal
      );
      cancelled(request.signal);
      const acquiredAt = new Date(this.clock()).toISOString();
      const value = normalizeKubernetesSnapshot({
        target: request.target,
        workload,
        replicaSets,
        pods,
        events,
        observedAt: acquiredAt,
        deploymentStartedAt: request.deploymentStartedAt
      });
      cancelled(request.signal);
      return Object.freeze({
        id: stableFingerprint({
          target: request.target,
          kind: request.kind,
          name: request.name,
          acquiredAt
        }),
        kind: "runtime.kubernetes.snapshot",
        state: "valid",
        source: Object.freeze({ provider: "kubernetes", capability: "runtime.snapshot" }),
        target: request.target,
        acquiredAt,
        observedAt: acquiredAt,
        value,
        diagnostics: Object.freeze([])
      });
    } catch (error) {
      if (error instanceof GateError) throw error;
      const status = statusCode(error);
      throw new GateError({
        code:
          status === 401
            ? "AUTHENTICATION"
            : status === 403
              ? "AUTHORIZATION"
              : status === 404
                ? "EVIDENCE_INVALID"
                : "PROVIDER_UNAVAILABLE",
        safeMessage:
          status === 403
            ? "Kubernetes API denied read access"
            : "Kubernetes evidence collection failed",
        retryable: status === undefined || status >= 500,
        provider: "kubernetes",
        cause: error
      });
    }
  }

  private selectorFor(workload: unknown): string | undefined {
    if (workload === null || typeof workload !== "object" || Array.isArray(workload))
      return undefined;
    const spec = (workload as { spec?: unknown }).spec;
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return undefined;
    const selector = (spec as { selector?: unknown }).selector;
    if (selector === null || typeof selector !== "object" || Array.isArray(selector))
      return undefined;
    const labels = (selector as { matchLabels?: unknown }).matchLabels;
    if (labels === null || typeof labels !== "object" || Array.isArray(labels)) return undefined;
    return Object.entries(labels as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
  }

  private async allPages(
    list: (request: KubernetesPageRequest) => Promise<KubernetesPage>,
    base: KubernetesPageRequest,
    signal: AbortSignal
  ): Promise<readonly unknown[]> {
    const items: unknown[] = [];
    let continueToken: string | undefined;
    const seenTokens = new Set<string>();
    let pages = 0;
    do {
      cancelled(signal);
      if (++pages > 100)
        throw new GateError({
          code: "PROVIDER_PROTOCOL",
          safeMessage: "Kubernetes pagination exceeded its page limit",
          retryable: false
        });
      const page = await withCancellation(
        () =>
          list({
            ...base,
            signal,
            ...(continueToken === undefined ? {} : { continueToken })
          }),
        signal
      );
      cancelled(signal);
      if (!Array.isArray(page.items) || items.length + page.items.length > 10_000)
        throw new GateError({
          code: "PROVIDER_PROTOCOL",
          safeMessage: "Kubernetes pagination exceeded its item limit",
          retryable: false
        });
      items.push(...page.items);
      continueToken = page.continueToken;
      if (continueToken !== undefined && continueToken.length > 0) {
        if (seenTokens.has(continueToken))
          throw new GateError({
            code: "PROVIDER_PROTOCOL",
            safeMessage: "Kubernetes pagination repeated a continuation token",
            retryable: false
          });
        seenTokens.add(continueToken);
      }
    } while (continueToken !== undefined && continueToken.length > 0);
    return items;
  }
}
