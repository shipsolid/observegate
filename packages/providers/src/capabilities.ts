export interface ProviderCapabilityMetadata {
  readonly family: string;
  readonly implementations: readonly string[];
  readonly capabilities: readonly string[];
  readonly authentication: string;
  readonly readOnly: boolean;
}

export const providerCapabilities: readonly ProviderCapabilityMetadata[] = Object.freeze([
  {
    family: "metrics",
    implementations: ["Prometheus", "Mimir"],
    capabilities: ["instant query", "range query"],
    authentication: "bearer/basic headers from environment",
    readOnly: true
  },
  {
    family: "logs",
    implementations: ["Loki"],
    capabilities: ["range query", "correlation search"],
    authentication: "bearer/basic headers from environment",
    readOnly: true
  },
  {
    family: "traces",
    implementations: ["Tempo"],
    capabilities: ["trace search", "service identity"],
    authentication: "bearer/basic headers from environment",
    readOnly: true
  },
  {
    family: "grafana",
    implementations: ["Grafana Cloud", "Grafana"],
    capabilities: ["dashboard read", "alert rule read", "notification route read", "SLO read"],
    authentication: "service-account/API token from environment",
    readOnly: true
  },
  {
    family: "runtime",
    implementations: ["Kubernetes", "AKS"],
    capabilities: ["workload snapshot", "pod snapshot", "event read", "manifest parse"],
    authentication: "ambient or kubeconfig",
    readOnly: true
  },
  {
    family: "runtime",
    implementations: ["Azure Container Apps"],
    capabilities: ["application read", "revision read", "replica read", "manifest parse"],
    authentication: "Azure workload identity/ambient credential",
    readOnly: true
  },
  {
    family: "runtime",
    implementations: ["Azure VM"],
    capabilities: ["VM instance view", "power state", "host evidence join"],
    authentication: "Azure workload identity/ambient credential",
    readOnly: true
  },
  {
    family: "runtime",
    implementations: ["Linux VM", "Windows VM"],
    capabilities: [
      "bounded host evidence",
      "service state",
      "release marker",
      "telemetry agent health"
    ],
    authentication: "signed workspace evidence files; no SSH or WinRM",
    readOnly: true
  },
  {
    family: "evidence",
    implementations: ["workspace files"],
    capabilities: [
      "SARIF",
      "OTLP contract",
      "deployment attestation",
      "synthetic results",
      "incident windows"
    ],
    authentication: "workspace boundary and optional compact JWS/JWKS",
    readOnly: true
  },
  {
    family: "http",
    implementations: ["guarded probe"],
    capabilities: ["HTTP status", "latency", "TLS"],
    authentication: "configured environment headers",
    readOnly: true
  }
]);
