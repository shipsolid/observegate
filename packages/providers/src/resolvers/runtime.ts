import type { Evidence } from "@observability-gate/core";
import {
  buildKubernetesReadClient,
  type KubernetesReadClient,
  type KubernetesWorkloadKind
} from "../runtime/kubernetes/client.js";
import { KubernetesRuntimeAdapter } from "../runtime/kubernetes/adapter.js";
import { buildAzureRuntimeClients } from "../runtime/azure/auth.js";
import {
  AzureContainerAppsAdapter,
  type ContainerAppsReadClient
} from "../runtime/azure/container-apps.js";
import {
  AzureVmRuntimeAdapter,
  type AzureVmReadClient
} from "../runtime/azure/virtual-machines.js";
import { GenericVmRuntimeAdapter } from "../runtime/vm/adapter.js";
import type { VmHostEvidence, VmAgentEvidence } from "../runtime/vm/host-evidence.js";
import type { VmReleaseEvidence, VmServiceEvidence } from "../runtime/vm/service-evidence.js";
import {
  activeRuntime,
  array,
  configuration,
  durationMs,
  field,
  invalid,
  loadFiles,
  mapped,
  number,
  record,
  string,
  type Context,
  type Data,
  type ResolverBase
} from "./shared.js";

export interface RuntimeClients {
  readonly kubernetes?: KubernetesReadClient;
  readonly containerApps?: ContainerAppsReadClient;
  readonly azureVm?: AzureVmReadClient;
}
export interface RuntimeResolver {
  readonly snapshot: (context: Context, fresh?: boolean) => Promise<Evidence<unknown>>;
  readonly resolve: (
    kind: string,
    definition: Data,
    context: Context
  ) => Promise<readonly Evidence<unknown>[] | undefined>;
}
function required(value: string | undefined, name: string): string {
  return value ?? configuration(`Active runtime requires ${name} or its environment reference`);
}
export function createRuntimeResolver(
  base: ResolverBase,
  clients: RuntimeClients = {}
): RuntimeResolver {
  const runtime = activeRuntime(base.policy),
    type = string(runtime.type),
    env = base.environment;
  let pending: Promise<Evidence<unknown>> | undefined;
  let consecutive = 0;
  let first: Data | undefined;
  let previous: Data | undefined;
  let vmEvidence:RuntimeResolver|undefined;
  function evidenceVm():RuntimeResolver {
    if(vmEvidence===undefined){const target=String(base.policy.execution.active_target);vmEvidence=createRuntimeResolver({...base,policy:{...base.policy,targets:{...base.policy.targets,definitions:{...record(base.policy.targets.definitions),[target]:{runtime:{...runtime,type:"generic_vm"}}}}}});}
    return vmEvidence;
  }
  let kube: KubernetesRuntimeAdapter | undefined,
    aca: AzureContainerAppsAdapter | undefined,
    azure: AzureVmRuntimeAdapter | undefined;
  const vm = new GenericVmRuntimeAdapter(base.now);
  async function collect(context: Context): Promise<Evidence<unknown>> {
    if (type === "kubernetes") {
      const contextName = field(runtime, "context", env);
      kube ??= new KubernetesRuntimeAdapter(
        clients.kubernetes ??
          buildKubernetesReadClient(contextName === undefined ? {} : { context: contextName }),
        base.now
      );
      const workload = record(runtime.workload),
        kind = string(workload.kind);
      if (kind !== "Deployment" && kind !== "StatefulSet" && kind !== "DaemonSet")
        configuration(
          "Kubernetes runtime workload.kind must be Deployment, StatefulSet, or DaemonSet"
        );
      return kube.getSnapshot({
        target: context.targetId,
        namespace: required(field(runtime, "namespace", env), "namespace"),
        kind: kind as KubernetesWorkloadKind,
        name: required(field(workload, "name", env), "workload.name"),
        deploymentStartedAt:
          string(record(base.policy.release.candidate).deployed_at) ??
          new Date(base.now()).toISOString(),
        signal: context.signal
      });
    }
    if (type === "azure_container_apps" || type === "azure_vm") {
      const built = (
        type === "azure_container_apps"
          ? clients.containerApps === undefined
          : clients.azureVm === undefined
      )
        ? buildAzureRuntimeClients({
            runtimeType: type,
            subscriptionId: required(field(runtime, "subscription_id", env), "subscription_id")
          })
        : undefined;
      const resourceGroup = required(field(runtime, "resource_group", env), "resource_group");
      if (type === "azure_container_apps") {
        aca ??= new AzureContainerAppsAdapter(
          clients.containerApps ?? (built?.containerAppsRead ?? configuration("Container Apps read client is unavailable")),
          base.now
        );
        return aca.getSnapshot({
          target: context.targetId,
          resourceGroup,
          appName: required(field(runtime, "application_name", env), "application_name"),
          revisionName: required(field(runtime, "revision_name", env), "revision_name"),
          signal: context.signal
        });
      }
      azure ??= new AzureVmRuntimeAdapter(clients.azureVm ?? (built?.vmRead ?? configuration("Azure VM read client is unavailable")), base.now);
      return azure.getSnapshot({
        target: context.targetId,
        resourceGroup,
        vmName: required(field(runtime, "virtual_machine_name", env), "virtual_machine_name"),
        signal: context.signal
      });
    }
    if (type === "linux_vm" || type === "windows_vm" || (type === "generic_vm" || type === "generic")) {
      const files = await loadFiles(base, {
        source: { files: array(record(runtime.artifacts).runtime_evidence) }
      });
      let data: Data;
      try {
        data = record(JSON.parse(files[0].content.toString("utf8")));
      } catch {
        return invalid(
          "VM runtime evidence must be JSON containing hosts, services, agents, and releases"
        );
      }
      const expectedHosts = array(runtime.expected_hosts).map(String);
      if (expectedHosts.length === 0)
        configuration("Evidence-only VM runtime requires runtime.expected_hosts");
      for (const [key, fields] of Object.entries({
        hosts: ["hostId", "cpuPercent", "memoryPercent", "diskPercent", "load"],
        services: ["hostId", "manager", "name", "state", "exitCode", "restarts"],
        agents: ["hostId", "up", "exportFailures", "queueUtilizationPercent", "lastExportAt"],
        releases: ["hostId", "releaseId"]
      })) {
        if (!Array.isArray(data[key])) invalid(`VM runtime evidence requires ${key} array`);
        const ids = new Set<string>();
        for (const row of array(data[key])) {
          const item = record(row);
          if (
            fields.some((f) => item[f] === undefined) ||
            typeof item.hostId !== "string" ||
            ids.has(item.hostId)
          )
            invalid(`VM ${key} evidence is incomplete or has duplicate hosts`);
          ids.add(item.hostId);
          for (const [field, value] of Object.entries(item)) {
            if (
              [
                "cpuPercent",
                "memoryPercent",
                "diskPercent",
                "load",
                "exitCode",
                "restarts",
                "exportFailures",
                "queueUtilizationPercent"
              ].includes(field) &&
              number(value) === undefined
            )
              invalid(`VM ${key}.${field} must be finite`);
          }
          if (
            key === "agents" &&
            (typeof item.up !== "boolean" ||
              !Number.isFinite(Date.parse(String(item.lastExportAt))))
          )
            invalid("VM agent timestamps and availability must be valid");
        }
      }
      return vm.getSnapshot({
        target: context.targetId,
        operatingSystem:
          string(runtime.operating_system) ?? (type === "linux_vm" ? "linux" : "windows"),
        expectedReleaseId: context.releaseId ?? "",
        expectedHosts,
        hosts: data.hosts as readonly VmHostEvidence[],
        services: data.services as readonly VmServiceEvidence[],
        agents: data.agents as readonly VmAgentEvidence[],
        releases: data.releases as readonly VmReleaseEvidence[],
        signal: context.signal
      });
    }
    return configuration(
      "Runtime evidence requires an active target with runtime.type and complete read-only adapter configuration"
    );
  }
  async function snapshot(context: Context, fresh = false): Promise<Evidence<unknown>> {
    if (fresh) {pending = undefined;if(type==="azure_vm"&&array(record(runtime.artifacts).runtime_evidence).length>0)await evidenceVm().snapshot(context,true);}
    pending ??= collect(context).then((raw) => {
      const value = record(raw.value);
      previous = first;
      first ??= value;
      const rollout = record(value.rollout),
        replicas = record(rollout.replicas ?? value.replicas);
      const hosts = array(value.hosts).map(record);
      const ready =
        type === "kubernetes"
          ? (number(replicas.desired) ?? 0) > 0 &&
            replicas.available === replicas.desired &&
            replicas.unavailable === 0
          : type === "azure_container_apps"
            ? (number(replicas.healthy) ?? 0) > 0 && replicas.failed === 0
            : type === "azure_vm"
              ? value.powerState === "running"
              : hosts.length > 0 &&
                hosts.every(
                  (h) =>
                    h.available === true &&
                    ["active", "running"].includes(String(record(h.service).state))
                );
      consecutive = raw.state === "valid" && ready ? consecutive + 1 : 0;
      return raw;
    });
    return pending;
  }
  async function resolve(
    kind: string,
    definition: Data,
    context: Context
  ): Promise<readonly Evidence<unknown>[] | undefined> {
    if (!(
      kind.startsWith("runtime.") ||
      kind.startsWith("vm.") ||
      kind.startsWith("kubernetes.") ||
      kind.startsWith("azure_container_apps.") ||
      kind === "azure_vm.instance_view"
    ))
      return undefined;
    if (context.phase === "pre_deployment" && kind !== "runtime.capacity" && kind !== "vm.capacity")
      return undefined;
    if (kind === "runtime.capacity") return undefined;
    if(type==="azure_vm"&&kind.startsWith("vm."))return evidenceVm().resolve(kind,definition,context);
    const raw = await snapshot(context),
      v = record(raw.value),
      a = record(definition.assertions),
      expected = record(runtime.expected),
      rollout = record(v.rollout),
      replicas = record(rollout.replicas ?? v.replicas),
      baseline = previous ?? {};
    const pods: Data[] = array(v.pods)
      .map(record)
      .map((p) => {
        const old = array(baseline.pods)
          .map(record)
          .find((o) => o.uid === p.uid && o.name === p.name);
        return {
          ...p,
          restartIncrease:
            old === undefined ? undefined : Math.max(0, Number(p.restarts) - Number(old.restarts)),
          probesHealthy:
            p.ready === true &&
            array(p.waitingReasons).length === 0 &&
            array(p.terminationReasons).length === 0
        };
      });
    const hosts: Data[] = array(v.hosts)
      .map(record)
      .map((h) => {
        const old = array(baseline.hosts)
          .map(record)
          .find((o) => o.hostId === h.hostId);
        const service = record(h.service);
        return {
          ...h,
          service: {
            ...service,
            restartIncrease:
              old === undefined
                ? undefined
                : Math.max(0, Number(service.restarts) - Number(record(old.service).restarts))
          }
        };
      });
    let value: Data = {
      ...v,
      expectedImageDigest: field(a, "expected_digest", env) ?? field(expected, "image_digest", env),
      pods,
      hosts,
      expectedHostIds: array(runtime.expected_hosts),
      expectedReleaseId: context.releaseId,
      maximumCpuPercent:
        number(a.maximum_cpu_percent) ??
        100 * (number(record(a.cpu_utilization).less_than_or_equal) ?? 0.8),
      maximumMemoryPercent:
        number(a.maximum_memory_percent) ??
        100 * (number(record(a.memory_utilization).less_than_or_equal) ?? 0.85),
      maximumDiskPercent:
        number(a.maximum_disk_percent) ??
        100 * (number(record(a.disk_utilization).less_than_or_equal) ?? 0.85),
      maximumLoad:
        number(a.maximum_load) ??
        number(record(a.load_or_queue_saturation).less_than_or_equal) ??
        1,
      maximumQueueUtilizationPercent:
        100 * (number(record(a.queue_utilization).less_than_or_equal) ?? 0.8),
      maximumLastExportAgeMs: durationMs(
        record(a.last_successful_export_age).less_than_or_equal,
        60000
      )
    };
    if (kind === "runtime.provisioned")
      value = {
        resourceExists: raw.state === "valid",
        provisioningState:
          v.provisioningState ??
          (array(v.conditions)
            .map(record)
            .some((c) => c.type === "Available" && c.status === "True")
            ? "available"
            : undefined),
        observedAt: v.observedAt,
        deployedAt: record(base.policy.release.candidate).deployed_at
      };
    if (kind === "runtime.ready")
      value = {
        ready: consecutive > 0,
        availableInstances:
          replicas.available ?? replicas.healthy ?? (type==="azure_vm"?(v.powerState==="running"?1:0):hosts.filter((h) => h.available).length),
        unavailableInstances:
          replicas.unavailable ?? replicas.failed ?? (type==="azure_vm"?(v.powerState==="running"?0:1):hosts.filter((h) => !h.available).length),
        minimumAvailableInstances:
          number(a.minimum_available_instances) ?? number(expected.minimum_available_replicas) ?? 1,
        consecutiveSuccessfulSamples: consecutive,
        requiredConsecutiveSamples:
          number(a.required_consecutive_samples) ?? number(a.consecutive_successful_samples) ?? 3
      };
    if (kind === "runtime.release_identity") return undefined;
    if (kind === "runtime.stability")
      value = {
        unexpectedRestarts: pods.length
          ? pods.reduce((sum, p) => sum + (number(p.restartIncrease) ?? Infinity), 0)
          : hosts.length
            ? hosts.reduce(
                (sum, h) => sum + (number(record(h.service).restartIncrease) ?? Infinity),
                0
              )
            : undefined,
        crashLoops: pods.filter((p) => array(p.waitingReasons).includes("CrashLoopBackOff")).length,
        outOfMemoryTerminations: pods.filter((p) => p.oomKilled === true).length,
        unhealthyInstances: pods.length
          ? pods.filter((p) => !p.ready).length
          : hosts.length
            ? hosts.filter((h) => !h.available).length
            : replicas.failed
      };
    if (kind === "kubernetes.rollout_status")
      value = {
        ...value,
        rollout: {
          ...rollout,
          durationMs:
            base.now() - Date.parse(String(record(base.policy.release.candidate).deployed_at)),
          maximumDurationMs: durationMs(a.rollout_completed_within, 600000)
        }
      };
    if (kind === "kubernetes.events")
      value = {
        ...value,
        forbiddenEventReasons: array(a.forbidden_reasons),
        maximumWarningEvents: number(a.maximum_warning_events) ?? 0
      };
    if (kind.startsWith("azure_container_apps."))
      value = {
        ...value,
        revision: {
          ...record(v.revision),
          expectedImageDigest:
            field(a, "expected_digest", env) ?? field(expected, "image_digest", env),
          expectedSuffix:
            field(a, "expected_revision_suffix", env) ?? field(expected, "revision_suffix", env)
        },
        replicas: {
          ...replicas,
          minimumHealthy: number(record(a.healthy_replicas).greater_than_or_equal) ?? 1,
          restartIncrease:
            previous === undefined
              ? undefined
              : Math.max(0, Number(replicas.restarts) - Number(record(previous.replicas).restarts)),
          unhealthy: replicas.failed
        },
        traffic: {
          ...record(v.traffic),
          minimumCandidateWeight: a.minimum_candidate_weight_percent,
          maximumUnknownRevisionWeight: a.maximum_unknown_revision_weight_percent
        }
      };
    if (kind === "azure_vm.instance_view")
      value = {
        ...value,
        maintenanceActive:
          v.maintenanceState === undefined
            ? undefined
            : !["none", "notrequired"].includes(String(v.maintenanceState).toLowerCase())
      };
    if (kind === "vm.capacity") {
      const caps = hosts.map((h) => record(h.capacity));
      value = {
        cpuHeadroomPercent: 100 - Math.max(...caps.map((c) => Number(c.cpuPercent))),
        memoryHeadroomPercent: 100 - Math.max(...caps.map((c) => Number(c.memoryPercent))),
        diskFreePercent: 100 - Math.max(...caps.map((c) => Number(c.diskPercent))),
        healthyHostsPercent: hosts.length
          ? (100 * hosts.filter((h) => h.available).length) / hosts.length
          : 0
      };
    }
    return [mapped(raw, kind, value)];
  }
  return { snapshot, resolve };
}
