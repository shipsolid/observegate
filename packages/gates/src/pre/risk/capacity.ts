import { assertion, createEvidenceGate } from "../../evaluation.js";

export const runtimeCapacityGate = createEvidenceGate({
  type: "runtime.capacity",
  description: "Validate runtime capacity and rollout surge schedulability.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    return [
      assertion(
        "CPU headroom",
        typeof value.cpuPercent === "number" &&
          value.cpuPercent <= Number(value.maximumCpuPercent ?? 80),
        "CPU utilization leaves deployment headroom",
        value.cpuPercent
      ),
      assertion(
        "memory headroom",
        typeof value.memoryPercent === "number" &&
          value.memoryPercent <= Number(value.maximumMemoryPercent ?? 80),
        "Memory utilization leaves deployment headroom",
        value.memoryPercent
      ),
      assertion(
        "disk headroom",
        typeof value.diskPercent === "number" &&
          value.diskPercent <= Number(value.maximumDiskPercent ?? 85),
        "Disk utilization leaves deployment headroom",
        value.diskPercent
      ),
      assertion(
        "surge schedulability",
        value.surgeSchedulable === true,
        "Rollout surge is schedulable"
      )
    ];
  }
});
