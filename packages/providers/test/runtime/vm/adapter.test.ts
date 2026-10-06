import { describe, expect, it } from "vitest";
import { GenericVmRuntimeAdapter } from "../../../src/index.js";

describe("GenericVmRuntimeAdapter", () => {
  it("joins Windows, Linux, host, agent, and release evidence by stable host ID", async () => {
    const adapter = new GenericVmRuntimeAdapter(() => Date.parse("2026-10-06T08:00:00.000Z"));
    const evidence = await adapter.getSnapshot({
      target: "vm-fleet",
      operatingSystem: "mixed",
      expectedReleaseId: "2026.10.6",
      expectedHosts: ["win-01", "linux-01"],
      services: [
        {
          hostId: "win-01",
          manager: "windows",
          name: "Checkout",
          state: "running",
          exitCode: 0,
          restarts: 1
        },
        {
          hostId: "linux-01",
          manager: "systemd",
          name: "checkout.service",
          state: "failed",
          exitCode: 1,
          restarts: 3
        }
      ],
      hosts: [
        { hostId: "win-01", cpuPercent: 50, memoryPercent: 60, diskPercent: 70, load: 1 },
        { hostId: "linux-01", cpuPercent: 95, memoryPercent: 90, diskPercent: 85, load: 8 }
      ],
      agents: [
        {
          hostId: "win-01",
          up: true,
          exportFailures: 0,
          queueUtilizationPercent: 5,
          lastExportAt: "2026-10-06T07:59:59.000Z"
        },
        {
          hostId: "linux-01",
          up: false,
          exportFailures: 4,
          queueUtilizationPercent: 98,
          lastExportAt: "2026-10-06T07:50:00.000Z"
        }
      ],
      releases: [
        { hostId: "win-01", releaseId: "2026.10.6" },
        { hostId: "linux-01", releaseId: "2026.10.5" }
      ],
      signal: new AbortController().signal
    });

    expect(evidence).toMatchObject({
      state: "valid",
      value: {
        hosts: [
          {
            hostId: "win-01",
            available: true,
            service: { manager: "windows", state: "running", exitCode: 0 },
            capacity: { cpuPercent: 50, memoryPercent: 60, diskPercent: 70, load: 1 },
            agent: {
              up: true,
              exportFailures: 0,
              queueUtilizationPercent: 5,
              lastExportAgeMs: 1000
            },
            release: { releaseId: "2026.10.6", matchesExpected: true }
          },
          {
            hostId: "linux-01",
            service: { manager: "systemd", state: "failed", exitCode: 1 },
            agent: { up: false, exportFailures: 4, queueUtilizationPercent: 98 },
            release: { releaseId: "2026.10.5", matchesExpected: false }
          }
        ]
      }
    });
  });

  it("marks a host absent from any required evidence source unavailable", async () => {
    const evidence = await new GenericVmRuntimeAdapter().getSnapshot({
      target: "fleet",
      operatingSystem: "linux",
      expectedReleaseId: "r1",
      expectedHosts: ["host-1"],
      services: [
        {
          hostId: "host-1",
          manager: "systemd",
          name: "app",
          state: "active",
          exitCode: 0,
          restarts: 0
        }
      ],
      hosts: [],
      agents: [
        {
          hostId: "host-1",
          up: true,
          exportFailures: 0,
          queueUtilizationPercent: 0,
          lastExportAt: new Date().toISOString()
        }
      ],
      releases: [{ hostId: "host-1", releaseId: "r1" }],
      signal: new AbortController().signal
    });
    expect(evidence.value?.hosts[0]).toMatchObject({ available: false, missingSources: ["host"] });
  });
});
