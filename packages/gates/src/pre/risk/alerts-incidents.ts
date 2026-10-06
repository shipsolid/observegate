import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

export const alertStateGate = createEvidenceGate({
  type: "grafana.alert_state",
  description: "Reject active service alerts.",
  phases: ["pre_deployment", "post_deployment"],
  providerRequirements: [{ provider: "grafana", capability: "alerting", required: true }],
  evaluate(_definition, value) {
    const alerts = Array.isArray(value.alerts) ? (value.alerts as EvidenceRecord[]) : [];
    const active = alerts.filter((alert) =>
      ["firing", "pending", "error"].includes(String(alert.state))
    );
    return [
      assertion(
        "evidence freshness",
        value.fresh === true,
        "Grafana alert evidence is within the configured maximum age",
        value.fresh,
        true
      ),
      assertion(
        "active alerts",
        active.length === 0,
        "No matching alert is firing, pending, or errored",
        active.length,
        0
      )
    ];
  }
});

export const incidentStateGate = createEvidenceGate({
  type: "evidence.incident_state",
  description: "Reject major active incidents for the service.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const incidents = Array.isArray(value.incidents) ? (value.incidents as EvidenceRecord[]) : [];
    const blocking = incidents.filter(
      (incident) =>
        ["critical", "major", "sev1", "sev2"].includes(String(incident.severity).toLowerCase()) &&
        ["investigating", "identified", "monitoring", "active"].includes(
          String(incident.state).toLowerCase()
        )
    );
    return [
      assertion(
        "active incidents",
        blocking.length === 0,
        "No major active incident blocks deployment",
        blocking.length,
        0
      )
    ];
  }
});
