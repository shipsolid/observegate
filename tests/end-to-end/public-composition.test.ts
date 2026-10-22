import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../../packages/config/src/index.js";
import { runCli } from "../../packages/cli/src/main.js";
import { runAction } from "../../packages/action/src/main.js";
import type { PolicyProviderSessionOptions } from "../../packages/providers/src/session.js";
import { FakeObservabilityStack } from "../integration/fake-observability-stack.js";

const families = [
  "kubernetes",
  "azure_container_apps",
  "azure_vm",
  "linux_vm",
  "windows_vm",
  "metrics",
  "logs",
  "traces",
  "grafana",
  "http"
] as const;

describe("default public composition by provider and runtime", () => {
  it.each(families.flatMap((family) => [true, false].map((healthy) => ({ family, healthy }))))(
    "$family CLI and Action healthy=$healthy",
    async ({ family, healthy }) => {
      const workspace = await mkdtemp(join(tmpdir(), "observegate-public-"));
      try {
        const now = Date.now(),
          stack = new FakeObservabilityStack("healthy", new Date(now).toISOString());
        const policy = parsePolicy(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
        policy.identity.canonical = {
          service_name: "checkout",
          service_namespace: "commerce",
          environment: "production",
          release_id: "release-candidate",
          deployment_id: "deployment-1"
        };
        policy.release.candidate = {
          id: "release-candidate",
          deployed_at: new Date(now - 60_000).toISOString()
        };
        policy.identity.provider_mappings = {
          metrics: {
            "service.name": "service_name",
            "service.namespace": "service_namespace",
            "service.version": "service_version",
            "deployment.environment.name": "deployment_environment"
          }
        };
        policy.gates.pre_deployment = [
          { id: "identity", name: "Identity", type: "identity.contract" }
        ];
        const telemetry = ["metrics", "logs", "traces", "grafana", "http"].includes(family);
        policy.targets.definitions.test = {
          runtime: {
            type: telemetry ? "generic" : family,
            provider: "runtime",
            namespace: "commerce",
            workload: { kind: "Deployment", name: "checkout" },
            resource_group: "rg",
            application_name: "checkout",
            revision_name: "checkout--candidate",
            virtual_machine_name: "vm",
            expected_hosts: ["host"],
            artifacts: { runtime_evidence: ["runtime.json"] }
          }
        };
        policy.providers.runtime = {
          runtime: {
            type:
              telemetry || (family.endsWith("_vm") && family !== "azure_vm")
                ? "evidence_only"
                : family === "kubernetes"
                  ? "kubernetes"
                  : "azure_resource_manager"
          }
        };
        policy.providers.telemetry = {
          metrics: { type: "prometheus", endpoint: "https://metrics.example.test" },
          logs: { type: "loki", endpoint: "https://logs.example.test/loki" },
          traces: { type: "tempo", endpoint: "https://traces.example.test" },
          grafana: { type: "grafana", endpoint: "https://grafana.example.test" }
        };
        policy.providers.http = {
          probe: { type: "http", allowed_hosts: ["service.example.test"] }
        };
        policy.gates.post_deployment = [
          {
            id: "runtime",
            name: "Runtime readiness",
            type: "runtime.ready",
            source: { adapter: "active" },
            assertions: { consecutive_successful_samples: 1 }
          }
        ];
        if (family === "linux_vm" || family === "windows_vm") {
          policy.gates.post_deployment = [
            {
              id: "release",
              name: "VM release",
              type: "vm.release_marker",
              source: { adapter: "active" },
              assertions: {
                expected_release_id: "release-candidate",
                maximum_distinct_release_ids: 1
              }
            }
          ];
        }
        if (family === "metrics")
          policy.gates.post_deployment = [
            {
              id: "metric",
              name: "Metric threshold",
              type: "metric.threshold",
              source: { provider: "metrics", query: "up" },
              assertions: { operator: "less_than", threshold: healthy ? 0.02 : 0.001 }
            }
          ];
        if (family === "logs" || family === "traces")
          policy.gates.post_deployment = [
            {
              id: "presence",
              name: "Telemetry presence",
              type: "telemetry.presence",
              source: {
                provider: family,
                query:
                  family === "logs"
                    ? '{service="checkout"}'
                    : { "resource.service.name": "checkout" }
              },
              assertions: { minimum_records: 1 }
            }
          ];
        if (family === "grafana")
          policy.gates.pre_deployment = [
            {
              id: "dashboard",
              name: "Dashboard readiness",
              type: "grafana.dashboard",
              source: { provider: "grafana", uid: "checkout" },
              assertions: { minimum_panels: 4 }
            }
          ];
        if (family === "http")
          policy.gates.post_deployment = [
            {
              id: "http",
              name: "HTTP response",
              type: "http.assertion",
              source: { provider: "probe", url: "https://service.example.test/health" },
              assertions: { expected_status: [200], response_json: { status: "ok" } }
            }
          ];
        await writeFile(
          join(workspace, "runtime.json"),
          JSON.stringify({
            hosts: [
              { hostId: "host", cpuPercent: 10, memoryPercent: 20, diskPercent: 30, load: 0.1 }
            ],
            services: [
              {
                hostId: "host",
                manager: family === "windows_vm" ? "windows" : "systemd",
                name: "checkout",
                state: family === "windows_vm" ? "running" : "active",
                exitCode: 0,
                restarts: 0
              }
            ],
            agents: [
              {
                hostId: "host",
                up: true,
                exportFailures: 0,
                queueUtilizationPercent: 0,
                lastExportAt: new Date(now).toISOString()
              }
            ],
            releases: [
              { hostId: "host", releaseId: healthy ? "release-candidate" : "wrong-release" }
            ]
          })
        );
        const providerOptions: NonNullable<Parameters<typeof runCli>[1]>["providerOptions"] = {
          resolveHostname: async () => ["203.0.113.10"],
          fetch: async (input) => {
            const url = new URL(input);
            if (family === "http") return Response.json({ status: healthy ? "ok" : "broken" });
            if (!healthy && family === "logs")
              return Response.json({
                status: "success",
                data: { resultType: "streams", result: [] }
              });
            if (!healthy && family === "traces") return Response.json({ traces: [] });
            if (!healthy && family === "grafana")
              return Response.json({
                dashboard: {
                  uid: "checkout",
                  title: "checkout",
                  panels: [],
                  templating: { list: [] }
                },
                meta: { updated: new Date(now).toISOString() }
              });
            return stack.fetch(url);
          },
          runtimeClients: {
            kubernetes: {
              readWorkload: async () => ({
                kind: "Deployment",
                metadata: {
                  name: "checkout",
                  namespace: "commerce",
                  uid: "workload",
                  generation: 1
                },
                spec: { replicas: 2 },
                status: {
                  observedGeneration: 1,
                  updatedReplicas: 2,
                  availableReplicas: healthy ? 2 : 0,
                  readyReplicas: healthy ? 2 : 0,
                  unavailableReplicas: healthy ? 0 : 2,
                  conditions: [{ type: "Available", status: healthy ? "True" : "False" }]
                }
              }),
              listReplicaSets: async () => ({ items: [] }),
              listPods: async () => ({ items: [] }),
              listEvents: async () => ({ items: [] })
            },
            containerApps: {
              getApp: async () => ({ provisioningState: "Succeeded" }),
              listRevisions: async function* () {
                yield {
                  name: "checkout--candidate",
                  provisioningState: "Provisioned",
                  runningState: "Running",
                  active: true,
                  template: { containers: [{ image: `image@sha256:${"a".repeat(64)}` }] }
                };
              },
              listReplicas: async () => [
                { runningState: "Running", containers: [{ ready: healthy, restartCount: 0 }] }
              ]
            },
            azureVm: {
              getInstanceView: async () => ({
                statuses: [
                  { code: "ProvisioningState/succeeded" },
                  { code: `PowerState/${healthy ? "running" : "stopped"}` }
                ]
              })
            }
          }
        } satisfies Partial<PolicyProviderSessionOptions>;
        await writeFile(join(workspace, "policy.yml"), stringify(policy));
        const phase = family === "grafana" ? "pre_deployment" : "post_deployment",
          cliReports = join(workspace, "cli-reports");
        let stdout = "",
          stderr = "";
        const code = await runCli(
          [
            "run",
            "--config",
            "policy.yml",
            "--phase",
            phase,
            "--json",
            "--output-directory",
            cliReports
          ],
          {
            workspaceRoot: workspace,
            environment: {},
            providerOptions,
            output: {
              stdout: (text) => {
                stdout += text;
              },
              stderr: (text) => {
                stderr += text;
              }
            }
          }
        );
        expect({ code, stdout, stderr }, stderr + stdout).toMatchObject({ code: healthy ? 0 : 1 });
        expect(JSON.parse(stdout).decision).toBe(healthy ? "pass" : "fail");
        const outputs = new Map<string, unknown>(),
          failures: string[] = [],
          actionReports = join(workspace, "action-reports");
        const inputs: Record<string, string> = {
          config: "policy.yml",
          phase,
          "output-directory": actionReports
        };
        await runAction({
          workspaceRoot: workspace,
          environment: {},
          providerOptions,
          runtime: {
            getInput: (name) => inputs[name] ?? "",
            setOutput: (name, value) => {
              outputs.set(name, value);
            },
            setFailed: (message) => {
              failures.push(message);
            },
            warning: () => undefined,
            writeSummary: async () => undefined
          }
        });
        expect(outputs.get("decision")).toBe(healthy ? "pass" : "fail");
        expect(failures.length).toBe(healthy ? 0 : 1);
        for (const directory of [cliReports, actionReports]) {
          const report = JSON.parse(
            await readFile(join(directory, "observability-gate.json"), "utf8")
          );
          expect(report.decision).toBe(healthy ? "pass" : "fail");
          expect(report.gates).toHaveLength(1);
          if (healthy) expect(report.evidenceCoveragePercent).toBe(100);
          for (const format of ["md", "xml", "sarif"])
            expect(
              (await readFile(join(directory, `observability-gate.${format}`))).length
            ).toBeGreaterThan(0);
        }
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    }
  );
});
