import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../../evaluation.js";

function hosts(value: EvidenceRecord): EvidenceRecord[] {
  return Array.isArray(value.hosts) ? (value.hosts as EvidenceRecord[]) : [];
}

function expectedHostsPresent(value: EvidenceRecord, observed: EvidenceRecord[]) {
  const expected = new Set(
    Array.isArray(value.expectedHostIds) ? value.expectedHostIds.map(String) : []
  );
  const actual = new Set(observed.map((host) => String(host.hostId)));
  return expected.size > 0 && [...expected].every((id) => actual.has(id));
}

export const azureVmInstanceViewGate = createEvidenceGate({
  type: "azure_vm.instance_view",
  description: "Validate Azure VM provisioning, power, and maintenance state.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    return [
      assertion(
        "provisioning state",
        String(value.provisioningState).toLowerCase() === "succeeded",
        "Azure VM provisioning succeeded",
        value.provisioningState,
        "succeeded"
      ),
      assertion(
        "power state",
        String(value.powerState).toLowerCase() === "running",
        "Azure VM is running",
        value.powerState,
        "running"
      ),
      assertion(
        "platform maintenance",
        value.maintenanceActive !== true,
        "Platform maintenance is not active",
        value.maintenanceActive,
        false
      )
    ];
  }
});

export const vmServiceHealthGate = createEvidenceGate({
  type: "vm.service_health",
  description: "Require service health on every expected VM host.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const observed = hosts(value);
    const services = observed.map((host) => record(host.service));
    return [
      assertion(
        "expected hosts",
        expectedHostsPresent(value, observed),
        "Every expected host is present",
        observed.map((host) => host.hostId),
        value.expectedHostIds
      ),
      assertion(
        "host evidence",
        observed.length > 0 && observed.every((host) => host.available === true),
        "Every host has complete evidence"
      ),
      assertion(
        "service state",
        services.every(
          (service) =>
            service !== undefined &&
            ["active", "running"].includes(String(service.state).toLowerCase())
        ),
        "Service is active on every host"
      ),
      assertion(
        "exit code",
        services.every((service) => service?.exitCode === 0),
        "Service exit code is zero on every host"
      ),
      assertion(
        "restart increase",
        services.every((service) => service?.restartIncrease === 0),
        "Service restarts did not increase"
      ),
      assertion(
        "failed units",
        services.every((service) => Number(service?.failedUnits ?? 0) === 0),
        "No systemd units failed"
      )
    ];
  }
});

export const vmReleaseMarkerGate = createEvidenceGate({
  type: "vm.release_marker",
  description: "Require one intended release marker across every VM host.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const observed = hosts(value);
    const releases = observed
      .map((host) => record(host.release)?.releaseId)
      .filter((release): release is string => typeof release === "string");
    return [
      assertion(
        "expected hosts",
        expectedHostsPresent(value, observed),
        "Every expected host is present"
      ),
      assertion(
        "release coverage",
        releases.length === observed.length && observed.length > 0,
        "Every host reports a release marker",
        releases.length,
        observed.length
      ),
      assertion(
        "release identity",
        typeof value.expectedReleaseId === "string" &&
          releases.every((release) => release === value.expectedReleaseId) &&
          new Set(releases).size === 1,
        "Every host reports the intended release",
        releases,
        value.expectedReleaseId
      )
    ];
  }
});

export const vmHostHealthGate = createEvidenceGate({
  type: "vm.host_health",
  description: "Validate CPU, memory, disk, load, and availability for every VM host.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const observed = hosts(value);
    const capacities = observed.map((host) => record(host.capacity));
    const within = (field: string, maximumField: string) =>
      capacities.every(
        (capacity) =>
          typeof capacity?.[field] === "number" &&
          typeof value[maximumField] === "number" &&
          capacity[field] <= value[maximumField]
      );
    return [
      assertion(
        "expected hosts",
        expectedHostsPresent(value, observed),
        "Every expected host is present"
      ),
      assertion(
        "available hosts",
        observed.length > 0 && observed.every((host) => host.available === true),
        "No VM host is unavailable"
      ),
      assertion(
        "CPU utilization",
        within("cpuPercent", "maximumCpuPercent"),
        "CPU utilization is within policy"
      ),
      assertion(
        "memory utilization",
        within("memoryPercent", "maximumMemoryPercent"),
        "Memory utilization is within policy"
      ),
      assertion(
        "disk utilization",
        within("diskPercent", "maximumDiskPercent"),
        "Disk utilization is within policy"
      ),
      assertion(
        "load saturation",
        within("load", "maximumLoad"),
        "Load or queue saturation is within policy"
      )
    ];
  }
});

export const vmAgentHealthGate = createEvidenceGate({
  type: "vm.agent_health",
  description: "Require healthy, current telemetry export from every VM agent.",
  phases: ["post_deployment"],
  evaluate(_definition, value) {
    const observed = hosts(value);
    const agents = observed.map((host) => record(host.agent));
    return [
      assertion(
        "expected hosts",
        expectedHostsPresent(value, observed),
        "Every expected host is present"
      ),
      assertion(
        "agent up",
        agents.length > 0 && agents.every((agent) => agent?.up === true),
        "Telemetry agent is up on every host"
      ),
      assertion(
        "export failures",
        agents.every((agent) => agent?.exportFailures === 0),
        "Telemetry agents have no export failures"
      ),
      assertion(
        "queue utilization",
        agents.every(
          (agent) =>
            typeof agent?.queueUtilizationPercent === "number" &&
            typeof value.maximumQueueUtilizationPercent === "number" &&
            agent.queueUtilizationPercent <= value.maximumQueueUtilizationPercent
        ),
        "Telemetry agent queues are within policy"
      ),
      assertion(
        "export freshness",
        agents.every(
          (agent) =>
            typeof agent?.lastExportAgeMs === "number" &&
            typeof value.maximumLastExportAgeMs === "number" &&
            agent.lastExportAgeMs <= value.maximumLastExportAgeMs
        ),
        "Telemetry agents exported recently"
      )
    ];
  }
});
