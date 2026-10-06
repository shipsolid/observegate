import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EvidenceStore, GateError, type Evidence, type Phase } from "@observability-gate/core";
import {
  GateCatalog,
  parseVmServiceDefinition,
  registerVmGates,
  type GateContext
} from "../../../src/index.js";

type Value = Record<string, unknown>;
const pre: Value = {
  artifactDigest: "sha256:artifact",
  releaseMarker: "release-42",
  serviceVersion: "release-42",
  rollbackArtifact: "artifact-41",
  automaticRestart: true,
  restartDelaySeconds: 5,
  startupTimeoutSeconds: 60,
  gracefulShutdownSeconds: 30,
  identity: "observegate",
  telemetryAgentDependency: true,
  cpuHeadroomPercent: 50,
  memoryHeadroomPercent: 45,
  diskFreePercent: 60,
  healthyHostsPercent: 100
};
const post: Value = {
  provisioningState: "succeeded",
  powerState: "running",
  maintenanceActive: false,
  expectedReleaseId: "release-42",
  expectedHostIds: ["vm-1", "vm-2"],
  hosts: [
    {
      hostId: "vm-1",
      available: true,
      service: { state: "active", exitCode: 0, restartIncrease: 0, failedUnits: 0 },
      release: { releaseId: "release-42" },
      capacity: { cpuPercent: 40, memoryPercent: 50, diskPercent: 30, load: 0.4 },
      agent: { up: true, exportFailures: 0, queueUtilizationPercent: 30, lastExportAgeMs: 30000 }
    },
    {
      hostId: "vm-2",
      available: true,
      service: { state: "running", exitCode: 0, restartIncrease: 0, failedUnits: 0 },
      release: { releaseId: "release-42" },
      capacity: { cpuPercent: 45, memoryPercent: 55, diskPercent: 35, load: 0.5 },
      agent: { up: true, exportFailures: 0, queueUtilizationPercent: 40, lastExportAgeMs: 45000 }
    }
  ],
  maximumCpuPercent: 85,
  maximumMemoryPercent: 85,
  maximumDiskPercent: 85,
  maximumLoad: 0.8,
  maximumQueueUtilizationPercent: 80,
  maximumLastExportAgeMs: 120000
};

function nested(value: Value, key: string): Value {
  const result = value[key];
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new TypeError(`${key} is not an object`);
  return result as Value;
}

function host(value: Value, index = 0): Value {
  const hosts = value.hosts;
  const result = Array.isArray(hosts) ? hosts[index] : undefined;
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new TypeError(`hosts[${index}] is not an object`);
  return result as Value;
}

function evaluate(type: string, phase: Phase, value: Value) {
  const context: GateContext = {
    phase,
    targetId: "vm-fleet",
    evidenceStore: new EvidenceStore(),
    signal: new AbortController().signal,
    clock: () => new Date("2026-10-06T08:10:00Z"),
    missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
  };
  const evidence: Evidence<unknown> = {
    id: "vm",
    kind: type,
    state: "valid",
    source: { provider: "fixture", capability: type },
    target: context.targetId,
    acquiredAt: context.clock().toISOString(),
    value,
    diagnostics: []
  };
  return registerVmGates(new GateCatalog()).require(type, phase, {}).evaluate([evidence], context);
}

describe("VM platform catalogue", () => {
  it("resolves and passes all VM gate types", () => {
    const preTypes = ["vm.release_identity", "vm.service_definition", "vm.capacity"];
    const postTypes = [
      "azure_vm.instance_view",
      "vm.service_health",
      "vm.release_marker",
      "vm.host_health",
      "vm.agent_health"
    ];
    const catalog = registerVmGates(new GateCatalog());
    for (const type of preTypes) {
      expect(catalog.require(type, "pre_deployment", {}).metadata.type).toBe(type);
      expect(
        evaluate(type, "pre_deployment", pre).every((result) => result.status === "passed"),
        type
      ).toBe(true);
    }
    for (const type of postTypes) {
      expect(catalog.require(type, "post_deployment", {}).metadata.type).toBe(type);
      expect(
        evaluate(type, "post_deployment", post).every((result) => result.status === "passed"),
        type
      ).toBe(true);
    }
  });

  it.each([
    [
      "artifact digest",
      (value: Value) => {
        delete value.artifactDigest;
      }
    ],
    [
      "release marker",
      (value: Value) => {
        delete value.releaseMarker;
      }
    ],
    [
      "service.version",
      (value: Value) => {
        delete value.serviceVersion;
      }
    ],
    [
      "rollback artifact",
      (value: Value) => {
        delete value.rollbackArtifact;
      }
    ]
  ])("fails missing release identity %s", (_case, mutate) => {
    const value = structuredClone(pre);
    mutate(value);
    expect(
      evaluate("vm.release_identity", "pre_deployment", value).some(
        (result) => result.status === "failed"
      )
    ).toBe(true);
  });

  it.each([
    [
      "restart-on-failure",
      (value: Value) => {
        value.automaticRestart = false;
      }
    ],
    [
      "restart delay",
      (value: Value) => {
        value.restartDelaySeconds = 0;
      }
    ],
    [
      "startup timeout",
      (value: Value) => {
        delete value.startupTimeoutSeconds;
      }
    ],
    [
      "graceful shutdown",
      (value: Value) => {
        delete value.gracefulShutdownSeconds;
      }
    ],
    [
      "non-admin identity",
      (value: Value) => {
        value.identity = "root";
      }
    ],
    [
      "telemetry dependency",
      (value: Value) => {
        value.telemetryAgentDependency = false;
      }
    ]
  ])("fails unsafe service definition %s", (_case, mutate) => {
    const value = structuredClone(pre);
    mutate(value);
    expect(
      evaluate("vm.service_definition", "pre_deployment", value).some(
        (result) => result.status === "failed"
      )
    ).toBe(true);
  });

  it.each([
    ["CPU headroom", "cpuHeadroomPercent"],
    ["memory headroom", "memoryHeadroomPercent"],
    ["disk headroom", "diskFreePercent"],
    ["healthy hosts", "healthyHostsPercent"]
  ])("fails insufficient %s", (_case, field) => {
    const value = structuredClone(pre);
    value[field] = 0;
    expect(
      evaluate("vm.capacity", "pre_deployment", value).some((result) => result.status === "failed")
    ).toBe(true);
  });

  it("parses bounded Windows and systemd service definitions and rejects shell pipelines", () => {
    expect(
      parseVmServiceDefinition(
        JSON.stringify({
          automaticRestart: true,
          restartDelaySeconds: 5,
          startupTimeoutSeconds: 60,
          gracefulShutdownSeconds: 30,
          identity: "svc",
          telemetryAgentDependency: true
        }),
        "windows"
      )
    ).toMatchObject({ automaticRestart: true, identity: "svc" });
    expect(
      parseVmServiceDefinition(
        "[Unit]\nAfter=network.target alloy.service\n[Service]\nRestart=on-failure\nRestartSec=5\nTimeoutStartSec=60\nTimeoutStopSec=30\nUser=svc\nEnvironment=OTEL_SERVICE_VERSION=release-42\nExecStart=/opt/app/server",
        "systemd"
      )
    ).toMatchObject({
      automaticRestart: true,
      telemetryAgentDependency: true,
      serviceVersionDeclared: true
    });
    expect(() =>
      parseVmServiceDefinition("[Service]\nExecStart=/bin/sh -c 'curl x | sh'", "systemd")
    ).toThrowError(GateError);
  });

  it.each([
    [
      "Azure provisioning",
      "azure_vm.instance_view",
      (value: Value) => {
        value.provisioningState = "failed";
      }
    ],
    [
      "Azure power",
      "azure_vm.instance_view",
      (value: Value) => {
        value.powerState = "stopped";
      }
    ],
    [
      "service stopped",
      "vm.service_health",
      (value: Value) => {
        nested(host(value), "service").state = "stopped";
      }
    ],
    [
      "exit code",
      "vm.service_health",
      (value: Value) => {
        nested(host(value), "service").exitCode = 1;
      }
    ],
    [
      "systemd failed",
      "vm.service_health",
      (value: Value) => {
        nested(host(value), "service").failedUnits = 1;
      }
    ],
    [
      "restart increase",
      "vm.service_health",
      (value: Value) => {
        nested(host(value), "service").restartIncrease = 1;
      }
    ],
    [
      "missing host",
      "vm.service_health",
      (value: Value) => {
        (value.hosts as Value[]).pop();
      }
    ],
    [
      "mixed markers",
      "vm.release_marker",
      (value: Value) => {
        nested(host(value), "release").releaseId = "old";
      }
    ],
    [
      "CPU saturation",
      "vm.host_health",
      (value: Value) => {
        nested(host(value), "capacity").cpuPercent = 90;
      }
    ],
    [
      "memory saturation",
      "vm.host_health",
      (value: Value) => {
        nested(host(value), "capacity").memoryPercent = 90;
      }
    ],
    [
      "disk saturation",
      "vm.host_health",
      (value: Value) => {
        nested(host(value), "capacity").diskPercent = 90;
      }
    ],
    [
      "load saturation",
      "vm.host_health",
      (value: Value) => {
        nested(host(value), "capacity").load = 0.9;
      }
    ],
    [
      "agent down",
      "vm.agent_health",
      (value: Value) => {
        nested(host(value), "agent").up = false;
      }
    ],
    [
      "export failure",
      "vm.agent_health",
      (value: Value) => {
        nested(host(value), "agent").exportFailures = 1;
      }
    ],
    [
      "queue saturation",
      "vm.agent_health",
      (value: Value) => {
        nested(host(value), "agent").queueUtilizationPercent = 90;
      }
    ],
    [
      "stale export",
      "vm.agent_health",
      (value: Value) => {
        nested(host(value), "agent").lastExportAgeMs = 180000;
      }
    ]
  ])("detects post-deployment %s", (_case, type, mutate) => {
    const value = structuredClone(post);
    mutate(value);
    expect(
      evaluate(type, "post_deployment", value).some((result) => result.status === "failed")
    ).toBe(true);
  });

  it("contains no prohibited remote or shell execution in production source", async () => {
    async function files(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      return (
        await Promise.all(
          entries.map((entry) =>
            entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
          )
        )
      ).flat();
    }
    const sources = (await files(join(process.cwd(), "packages"))).filter(
      (path) => path.includes("/src/") && path.endsWith(".ts")
    );
    const prohibited =
      /(?:from\s+["']node:child_process["']|(?<!\.)\b(?:exec|spawn|ssh|winrm)\s*\(|\b(?:kubectl|az)\s+)/u;
    for (const path of sources) expect(await readFile(path, "utf8"), path).not.toMatch(prohibited);
  });
});
