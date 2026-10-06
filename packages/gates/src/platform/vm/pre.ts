import { GateError } from "@observability-gate/core";
import { assertion, createEvidenceGate, record } from "../../evaluation.js";

export interface VmServiceDefinition {
  readonly automaticRestart: boolean;
  readonly restartDelaySeconds?: number;
  readonly startupTimeoutSeconds?: number;
  readonly gracefulShutdownSeconds?: number;
  readonly identity?: string;
  readonly telemetryAgentDependency: boolean;
  readonly serviceVersionDeclared?: boolean;
}

function rejectShellPipeline(value: string): void {
  if (/(?:\||&&|;|>|<|\$\(|`|\b(?:sh|bash|pwsh|powershell)\s+-c\b)/u.test(value)) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "Service definition contains prohibited shell execution",
      retryable: false
    });
  }
}

export function parseVmServiceDefinition(
  content: string,
  manager: "windows" | "systemd"
): VmServiceDefinition {
  if (manager === "windows") {
    let value: Readonly<Record<string, unknown>> | undefined;
    try {
      value = record(JSON.parse(content) as unknown);
    } catch {
      value = undefined;
    }
    if (value === undefined)
      throw new GateError({
        code: "EVIDENCE_INVALID",
        safeMessage: "Windows service definition is invalid JSON",
        retryable: false
      });
    for (const candidate of Object.values(value))
      if (typeof candidate === "string") rejectShellPipeline(candidate);
    return {
      automaticRestart: value.automaticRestart === true,
      ...(typeof value.restartDelaySeconds === "number"
        ? { restartDelaySeconds: value.restartDelaySeconds }
        : {}),
      ...(typeof value.startupTimeoutSeconds === "number"
        ? { startupTimeoutSeconds: value.startupTimeoutSeconds }
        : {}),
      ...(typeof value.gracefulShutdownSeconds === "number"
        ? { gracefulShutdownSeconds: value.gracefulShutdownSeconds }
        : {}),
      ...(typeof value.identity === "string" ? { identity: value.identity } : {}),
      telemetryAgentDependency: value.telemetryAgentDependency === true,
      serviceVersionDeclared: value.serviceVersionDeclared === true
    };
  }
  const properties = new Map<string, string[]>();
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("[")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0)
      throw new GateError({
        code: "EVIDENCE_INVALID",
        safeMessage: "systemd service definition contains an invalid directive",
        retryable: false
      });
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (key.startsWith("Exec")) rejectShellPipeline(value);
    properties.set(key, [...(properties.get(key) ?? []), value]);
  }
  const after = [...(properties.get("After") ?? []), ...(properties.get("Requires") ?? [])].join(
    " "
  );
  const environment = (properties.get("Environment") ?? []).join(" ");
  const numeric = (key: string) => {
    const raw = properties.get(key)?.[0];
    return raw === undefined ? undefined : Number(raw.replace(/s$/u, ""));
  };
  const restart = properties.get("Restart")?.[0];
  const restartDelaySeconds = numeric("RestartSec");
  const startupTimeoutSeconds = numeric("TimeoutStartSec");
  const gracefulShutdownSeconds = numeric("TimeoutStopSec");
  const identity = properties.get("User")?.[0];
  return {
    automaticRestart: restart === "on-failure" || restart === "always",
    ...(restartDelaySeconds === undefined ? {} : { restartDelaySeconds }),
    ...(startupTimeoutSeconds === undefined ? {} : { startupTimeoutSeconds }),
    ...(gracefulShutdownSeconds === undefined ? {} : { gracefulShutdownSeconds }),
    ...(identity === undefined ? {} : { identity }),
    telemetryAgentDependency: /(?:alloy|otelcol)/iu.test(after),
    serviceVersionDeclared: /OTEL_SERVICE_VERSION=/u.test(environment)
  };
}

export const vmReleaseIdentityGate = createEvidenceGate({
  type: "vm.release_identity",
  description: "Require immutable VM release and rollback identity.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    return [
      assertion(
        "artifact digest",
        typeof value.artifactDigest === "string" && value.artifactDigest.length > 0,
        "Artifact digest is declared"
      ),
      assertion(
        "release marker",
        typeof value.releaseMarker === "string" && value.releaseMarker.length > 0,
        "Release marker is declared"
      ),
      assertion(
        "service.version",
        typeof value.serviceVersion === "string" && value.serviceVersion.length > 0,
        "service.version environment is declared"
      ),
      assertion(
        "rollback artifact",
        typeof value.rollbackArtifact === "string" && value.rollbackArtifact.length > 0,
        "Rollback artifact is declared"
      )
    ];
  }
});

export const vmServiceDefinitionGate = createEvidenceGate({
  type: "vm.service_definition",
  description: "Validate bounded Windows or systemd service-manager policy.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const delay = typeof value.restartDelaySeconds === "number" ? value.restartDelaySeconds : 0;
    return [
      assertion(
        "automatic restart",
        value.automaticRestart === true,
        "Service restarts automatically on failure"
      ),
      assertion("restart delay", delay > 0 && delay <= 60, "Restart delay is bounded", delay),
      assertion(
        "startup timeout",
        typeof value.startupTimeoutSeconds === "number" && value.startupTimeoutSeconds > 0,
        "Startup timeout is declared"
      ),
      assertion(
        "graceful shutdown",
        typeof value.gracefulShutdownSeconds === "number" && value.gracefulShutdownSeconds > 0,
        "Graceful shutdown is declared"
      ),
      assertion(
        "non-admin identity",
        typeof value.identity === "string" &&
          !["root", "administrator", "localsystem"].includes(value.identity.toLowerCase()),
        "Service uses a non-admin identity"
      ),
      assertion(
        "telemetry dependency",
        value.telemetryAgentDependency === true,
        "Telemetry agent dependency is declared"
      )
    ];
  }
});

export const vmCapacityGate = createEvidenceGate({
  type: "vm.capacity",
  description: "Validate VM fleet deployment headroom.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    return [
      assertion(
        "CPU headroom",
        typeof value.cpuHeadroomPercent === "number" && value.cpuHeadroomPercent >= 25,
        "CPU headroom meets policy",
        value.cpuHeadroomPercent,
        25
      ),
      assertion(
        "memory headroom",
        typeof value.memoryHeadroomPercent === "number" && value.memoryHeadroomPercent >= 20,
        "Memory headroom meets policy",
        value.memoryHeadroomPercent,
        20
      ),
      assertion(
        "disk headroom",
        typeof value.diskFreePercent === "number" && value.diskFreePercent >= 15,
        "Disk free space meets policy",
        value.diskFreePercent,
        15
      ),
      assertion(
        "healthy hosts",
        typeof value.healthyHostsPercent === "number" && value.healthyHostsPercent >= 90,
        "Healthy host percentage meets policy",
        value.healthyHostsPercent,
        90
      )
    ];
  }
});
