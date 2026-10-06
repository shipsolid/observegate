import { assertion, createEvidenceGate, record, type EvidenceRecord } from "../../evaluation.js";

function located(
  value: EvidenceRecord,
  name: string,
  passed: boolean,
  message: string,
  observed: unknown,
  path: string,
  expected?: unknown
) {
  return assertion(name, passed, message, { value: observed, path }, expected);
}

export const containerAppsConfigurationGate = createEvidenceGate({
  type: "azure_container_apps.configuration",
  description: "Validate release-safe Azure Container Apps configuration.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const image = typeof value.image === "string" ? value.image : "";
    const otel = record(value.otelEnvironment) ?? {};
    return [
      located(
        value,
        "digest-pinned image",
        /@sha256:[a-f0-9]{64}$/iu.test(image),
        "Container image is pinned by sha256 digest",
        image,
        "$.properties.template.containers[0].image"
      ),
      located(
        value,
        "revision mode",
        value.revisionMode === "Multiple",
        "Active revision mode is Multiple",
        value.revisionMode,
        "$.properties.configuration.activeRevisionsMode",
        "Multiple"
      ),
      located(
        value,
        "ingress transport",
        typeof value.ingressTransport === "string" && value.ingressTransport.length > 0,
        "Ingress transport is declared",
        value.ingressTransport,
        "$.properties.configuration.ingress.transport"
      ),
      located(
        value,
        "minimum replicas",
        typeof value.minimumReplicas === "number" && value.minimumReplicas >= 2,
        "Minimum replicas preserve availability",
        value.minimumReplicas,
        "$.properties.template.scale.minReplicas",
        2
      ),
      located(
        value,
        "maximum replicas",
        typeof value.maximumReplicas === "number" && value.maximumReplicas >= 2,
        "Maximum replicas allow availability",
        value.maximumReplicas,
        "$.properties.template.scale.maxReplicas",
        2
      ),
      located(
        value,
        "OTel service identity",
        typeof otel.OTEL_SERVICE_NAME === "string" && otel.OTEL_SERVICE_NAME.length > 0,
        "OTel service identity is configured",
        otel.OTEL_SERVICE_NAME,
        "$.properties.template.containers[0].env[OTEL_SERVICE_NAME]"
      ),
      located(
        value,
        "OTel exporter",
        typeof otel.OTEL_EXPORTER_OTLP_ENDPOINT === "string" &&
          otel.OTEL_EXPORTER_OTLP_ENDPOINT.length > 0,
        "OTel exporter endpoint is configured",
        otel.OTEL_EXPORTER_OTLP_ENDPOINT,
        "$.properties.template.containers[0].env[OTEL_EXPORTER_OTLP_ENDPOINT]"
      ),
      located(
        value,
        "managed identity",
        typeof value.managedIdentity === "string" && value.managedIdentity !== "None",
        "Managed identity is enabled",
        value.managedIdentity,
        "$.identity.type"
      )
    ];
  }
});

export const containerAppsProbesGate = createEvidenceGate({
  type: "azure_container_apps.probes",
  description: "Validate Container Apps startup, readiness, and liveness probes.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const probes = Array.isArray(value.probes) ? (value.probes as EvidenceRecord[]) : [];
    const ingressPort = value.ingressPort;
    const results = ["Startup", "Readiness", "Liveness"].map((type) => {
      const index = probes.findIndex((probe) => probe.type === type);
      return located(
        value,
        `${type.toLowerCase()} probe`,
        index >= 0,
        `${type} probe is configured`,
        index >= 0,
        `$.properties.template.containers[0].probes[?(@.type=='${type}')]`,
        true
      );
    });
    for (const [index, probe] of probes.entries()) {
      const port = record(probe.httpGet)?.port ?? record(probe.tcpSocket)?.port;
      results.push(
        located(
          value,
          `${String(probe.type ?? "probe").toLowerCase()} port`,
          typeof ingressPort === "number" && port === ingressPort,
          "Probe port matches ingress target port",
          port,
          `$.properties.template.containers[0].probes[${index}]`,
          ingressPort
        )
      );
    }
    return results;
  }
});
