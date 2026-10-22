import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceStore } from "@observability-gate/core";
import {
  createPolicyProviderSession,
  validateProviderAcquisition,
  type ProviderPolicy,
  type KubernetesReadClient,
  type ContainerAppsReadClient
} from "@observability-gate/providers";
import { describe, expect, it } from "vitest";

const now = Date.now();
function policy(runtime: Record<string, unknown> = {}): ProviderPolicy {
  return {
    identity: {
      canonical: {
        service_name: "checkout",
        service_namespace: "commerce",
        environment: "production",
        release_id: "release-2"
      }
    },
    release: {
      candidate: { deployed_at: new Date(now - 60000).toISOString() },
      baseline: { explicit_release_id: "release-1" }
    },
    observation: {},
    execution: { active_target: "target" },
    targets: { definitions: { target: { runtime } } },
    providers: { telemetry: { metrics: { endpoint: "https://metrics.example.test" } } },
    gates: {},
    reporting: {},
    security: {},
    limits: {}
  };
}
const context = () => ({
  phase: "post_deployment" as const,
  targetId: "target",
  releaseId: "release-2",
  evidenceStore: new EvidenceStore(() => new Date(now)),
  signal: new AbortController().signal,
  clock: () => new Date(now)
});
const kube = (available: number): KubernetesReadClient => ({
  readWorkload: async () => ({
    kind: "Deployment",
    metadata: {
      name: "checkout",
      namespace: "commerce",
      uid: "workload",
      generation: 1,
      labels: { "app.kubernetes.io/version": "release-2" }
    },
    spec: { replicas: 2 },
    status: {
      observedGeneration: 1,
      updatedReplicas: 2,
      availableReplicas: available,
      readyReplicas: available,
      unavailableReplicas: 2 - available,
      conditions: [{ type: "Available", status: available === 2 ? "True" : "False" }]
    }
  }),
  listReplicaSets: async () => ({ items: [] }),
  listPods: async () => ({ items: [] }),
  listEvents: async () => ({ items: [] })
});

describe("default read-only provider composition", () => {
  it.each([2, 0])("acquires Kubernetes readiness with %s available replicas", async (available) => {
    let reads = 0;
    const client = kube(available),
      p = policy({
        type: "kubernetes",
        namespace: "commerce",
        workload: { kind: "Deployment", name: "checkout" }
      });
    const definition = {
      type: "runtime.ready",
      source: { adapter: "active" },
      assertions: { required_consecutive_samples: 2 }
    };
    const session = createPolicyProviderSession({
      policy: { ...p, gates: { post_deployment: [definition] } },
      workspaceRoot: process.cwd(),
      environment: {},
      runtimeClients: {
        kubernetes: {
          ...client,
          readWorkload: async (request) => {
            reads++;
            return client.readWorkload(request);
          }
        }
      },
      clock: () => now
    });
    await session.sample?.(context().signal);
    await session.sample?.(context().signal);
    const raw = await session.resolveEvidence?.("runtime.ready", definition, context());
    expect(raw?.[0]?.value).toMatchObject({
      ready: available === 2,
      availableInstances: available,
      unavailableInstances: 2 - available,
      consecutiveSuccessfulSamples: available === 2 ? 2 : 0
    });
    expect(reads).toBe(2);
  });
  it.each([true, false])(
    "uses Container Apps revision/replica API reads with healthy=%s",
    async (healthy) => {
      const client: ContainerAppsReadClient = {
        getApp: async () => ({
          provisioningState: "Succeeded",
          configuration: {
            ingress: { traffic: [{ revisionName: "checkout--release-2", weight: 100 }] }
          }
        }),
        listRevisions: async function* () {
          yield {
            name: "checkout--release-2",
            provisioningState: "Provisioned",
            runningState: "Running",
            active: true,
            template: { containers: [{ image: `image@sha256:${"a".repeat(64)}` }] }
          };
        },
        listReplicas: async () => [
          { runningState: "Running", containers: [{ ready: healthy, restartCount: 0 }] }
        ]
      };
      const session = createPolicyProviderSession({
        policy: policy({
          type: "azure_container_apps",
          resource_group: "rg",
          application_name: "checkout",
          revision_name: "checkout--release-2"
        }),
        workspaceRoot: process.cwd(),
        environment: {},
        runtimeClients: { containerApps: client },
        clock: () => now
      });
      const raw = await session.resolveEvidence?.(
        "azure_container_apps.revision_status",
        { source: { adapter: "active" } },
        context()
      );
      expect(raw?.[0]?.source).toEqual({
        provider: "azure",
        capability: "container-apps.snapshot"
      });
      expect(raw?.[0]?.value).toMatchObject({
        replicas: { healthy: healthy ? 1 : 0, failed: healthy ? 0 : 1 }
      });
    }
  );
  it.each(["running", "stopped"])(
    "uses Azure VM instance-view adapter for power=%s",
    async (power) => {
      const session = createPolicyProviderSession({
        policy: policy({ type: "azure_vm", resource_group: "rg", virtual_machine_name: "vm" }),
        workspaceRoot: process.cwd(),
        environment: {},
        runtimeClients: {
          azureVm: {
            getInstanceView: async () => ({
              statuses: [{ code: "ProvisioningState/succeeded" }, { code: `PowerState/${power}` }]
            })
          }
        },
        clock: () => now
      });
      const raw = await session.resolveEvidence?.(
        "azure_vm.instance_view",
        { source: { adapter: "active" } },
        context()
      );
      expect(raw?.[0]?.value).toMatchObject({ powerState: power, provisioningState: "succeeded" });
    }
  );
  it.each(["release-2", "wrong-release"])(
    "normalizes evidence-only Linux VM host and marker files for %s",
    async (release) => {
      const root = await mkdtemp(join(tmpdir(), "observegate-vm-"));
      try {
        await writeFile(
          join(root, "runtime.json"),
          JSON.stringify({
            hosts: [
              { hostId: "host", cpuPercent: 10, memoryPercent: 20, diskPercent: 30, load: 0.2 }
            ],
            services: [
              {
                hostId: "host",
                manager: "systemd",
                name: "checkout",
                state: "running",
                exitCode: 0,
                restarts: 0
              }
            ],
            agents: [
              {
                hostId: "host",
                up: true,
                exportFailures: 0,
                queueUtilizationPercent: 5,
                lastExportAt: new Date(now).toISOString()
              }
            ],
            releases: [{ hostId: "host", releaseId: release }]
          })
        );
        const session = createPolicyProviderSession({
          policy: policy({
            type: "linux_vm",
            expected_hosts: ["host"],
            artifacts: { runtime_evidence: ["runtime.json"] }
          }),
          workspaceRoot: root,
          environment: {},
          clock: () => Date.now()
        });
        const raw = await session.resolveEvidence?.(
          "vm.release_marker",
          { source: { adapter: "active" } },
          context()
        );
        expect(raw?.[0]?.source.capability).toBe("vm.snapshot");
        expect(raw?.[0]?.value).toMatchObject({
          hosts: [{ release: { releaseId: release, matchesExpected: release === "release-2" } }]
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
  it.each([0.1, 0.9])(
    "acquires distinct candidate and baseline comparison queries (%s)",
    async (candidateValue) => {
      const calls: string[] = [];
      const session = createPolicyProviderSession({
        policy: policy(),
        workspaceRoot: process.cwd(),
        environment: {},
        resolveHostname: async () => ["203.0.113.10"],
        fetch: async (input) => {
          const q = new URL(String(input)).searchParams.get("query") ?? "";
          calls.push(q);
          return new Response(
            JSON.stringify({
              status: "success",
              data: {
                resultType: "vector",
                result: [
                  {
                    metric: {},
                    value: [now / 1000, String(q === "candidate" ? candidateValue : 0.2)]
                  }
                ]
              }
            })
          );
        },
        clock: () => now
      });
      const raw = await session.resolveEvidence?.(
        "comparison.metric",
        {
          source: {
            provider: "metrics",
            candidate: { query: "candidate", release_id: "release-2" },
            baseline: { query: "baseline", release_id: "release-1" }
          },
          assertions: { maximum_relative_regression_percent: 20 }
        },
        context()
      );
      expect(calls).toEqual(["candidate", "baseline"]);
      expect(raw?.[0]?.value).toMatchObject({
        candidate: { value: candidateValue, releaseId: "release-2" },
        baseline: { value: 0.2, releaseId: "release-1" }
      });
    }
  );
  it("rejects underspecified contracts offline without touching a provider", () => {
    const p = policy();
    expect(
      validateProviderAcquisition(
        {
          ...p,
          gates: {
            post_deployment: [
              {
                id: "errors",
                type: "metric.threshold",
                source: { provider: "metrics", query: "ratio" },
                assertions: { minimum_requests: 200 }
              }
            ]
          }
        },
        "post_deployment"
      )
    ).toEqual([expect.stringContaining("request_count_query")]);
  });
});
