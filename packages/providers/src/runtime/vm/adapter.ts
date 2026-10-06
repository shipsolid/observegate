import { GateError, stableFingerprint, type Evidence } from "@observability-gate/core";
import type { RuntimeSnapshot } from "../types.js";
import type { VmAgentEvidence, VmHostEvidence } from "./host-evidence.js";
import type { VmReleaseEvidence, VmServiceEvidence } from "./service-evidence.js";

export interface GenericVmSnapshotRequest {
  readonly target: string;
  readonly operatingSystem: string;
  readonly expectedReleaseId: string;
  readonly expectedHosts: readonly string[];
  readonly services: readonly VmServiceEvidence[];
  readonly hosts: readonly VmHostEvidence[];
  readonly agents: readonly VmAgentEvidence[];
  readonly releases: readonly VmReleaseEvidence[];
  readonly signal: AbortSignal;
}

export interface GenericVmHostSnapshot {
  readonly hostId: string;
  readonly available: boolean;
  readonly missingSources: readonly ("service" | "host" | "agent" | "release")[];
  readonly service?: VmServiceEvidence;
  readonly capacity?: Omit<VmHostEvidence, "hostId">;
  readonly agent?: Omit<VmAgentEvidence, "hostId" | "lastExportAt"> & {
    readonly lastExportAt: string;
    readonly lastExportAgeMs: number;
  };
  readonly release?: { readonly releaseId: string; readonly matchesExpected: boolean };
}

export interface GenericVmSnapshot extends RuntimeSnapshot {
  readonly operatingSystem: string;
  readonly hosts: readonly GenericVmHostSnapshot[];
}

function byHost<T extends { readonly hostId: string }>(
  items: readonly T[]
): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.hostId, item]));
}

export class GenericVmRuntimeAdapter {
  public constructor(private readonly clock: () => number = Date.now) {}

  public async getSnapshot(
    request: GenericVmSnapshotRequest
  ): Promise<Evidence<GenericVmSnapshot>> {
    if (request.signal.aborted) {
      throw new GateError({
        code: "CANCELLED",
        safeMessage: "VM evidence collection was cancelled",
        retryable: false,
        cause: request.signal.reason
      });
    }
    const services = byHost(request.services);
    const hosts = byHost(request.hosts);
    const agents = byHost(request.agents);
    const releases = byHost(request.releases);
    const now = this.clock();
    const normalizedHosts = request.expectedHosts.map((hostId): GenericVmHostSnapshot => {
      const service = services.get(hostId);
      const host = hosts.get(hostId);
      const agent = agents.get(hostId);
      const release = releases.get(hostId);
      const missingSources = [
        ...(service === undefined ? ["service" as const] : []),
        ...(host === undefined ? ["host" as const] : []),
        ...(agent === undefined ? ["agent" as const] : []),
        ...(release === undefined ? ["release" as const] : [])
      ];
      return Object.freeze({
        hostId,
        available: missingSources.length === 0,
        missingSources: Object.freeze(missingSources),
        ...(service === undefined ? {} : { service }),
        ...(host === undefined
          ? {}
          : {
              capacity: Object.freeze({
                cpuPercent: host.cpuPercent,
                memoryPercent: host.memoryPercent,
                diskPercent: host.diskPercent,
                load: host.load
              })
            }),
        ...(agent === undefined
          ? {}
          : {
              agent: Object.freeze({
                up: agent.up,
                exportFailures: agent.exportFailures,
                queueUtilizationPercent: agent.queueUtilizationPercent,
                lastExportAt: agent.lastExportAt,
                lastExportAgeMs: Math.max(0, now - Date.parse(agent.lastExportAt))
              })
            }),
        ...(release === undefined
          ? {}
          : {
              release: Object.freeze({
                releaseId: release.releaseId,
                matchesExpected: release.releaseId === request.expectedReleaseId
              })
            })
      });
    });
    const acquiredAt = new Date(now).toISOString();
    const value: GenericVmSnapshot = Object.freeze({
      target: request.target,
      runtimeType: "generic_vm",
      observedAt: acquiredAt,
      releaseIdentities: Object.freeze(
        request.releases.map((release) =>
          Object.freeze({
            source: "release-marker",
            releaseId: release.releaseId,
            instanceId: release.hostId
          })
        )
      ),
      conditions: Object.freeze([]),
      events: Object.freeze([]),
      operatingSystem: request.operatingSystem,
      hosts: Object.freeze(normalizedHosts)
    });
    return Object.freeze({
      id: stableFingerprint({ target: request.target, acquiredAt }),
      kind: "runtime.vm.snapshot",
      state: "valid",
      source: Object.freeze({ provider: "evidence", capability: "vm.snapshot" }),
      target: request.target,
      acquiredAt,
      observedAt: acquiredAt,
      value,
      diagnostics: Object.freeze([])
    });
  }
}
