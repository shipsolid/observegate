import { assertion, createEvidenceGate, type EvidenceRecord } from "../../evaluation.js";

const grafana = [{ provider: "grafana", capability: "read", required: true }] as const;

export const assetMetadataGate = createEvidenceGate({
  type: "asset.metadata",
  description: "Validate service ownership metadata.",
  phases: ["pre_deployment"],
  evaluate(_definition, value) {
    const owner = typeof value.owner === "string" ? value.owner.trim() : "";
    return [
      assertion(
        "owner",
        owner.length > 0 && !/^(todo|unknown|team)$/iu.test(owner),
        "A non-placeholder owner is declared",
        owner
      ),
      assertion(
        "escalation",
        typeof value.escalationContact === "string" && value.escalationContact.length > 0,
        "An escalation contact is declared"
      )
    ];
  }
});

export const assetUrlGate = createEvidenceGate({
  type: "asset.url",
  description: "Validate a constrained HTTPS asset URL.",
  phases: ["pre_deployment"],
  providerRequirements: [{ provider: "http", capability: "probe", required: true }],
  evaluate(_definition, value) {
    return [
      assertion("reachable", value.reachable === true, "Asset URL is reachable"),
      assertion("HTTPS", value.scheme === "https", "Asset URL uses HTTPS", value.scheme, "https"),
      assertion("document", value.nonempty === true, "Asset URL returns a non-empty document")
    ];
  }
});

export const dashboardGate = createEvidenceGate({
  type: "grafana.dashboard",
  description: "Validate service dashboard metadata.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    const panels = Array.isArray(value.panels) ? value.panels : [];
    const variables = Array.isArray(value.variables) ? value.variables : [];
    return [
      assertion("dashboard exists", typeof value.uid === "string", "Dashboard exists"),
      assertion(
        "panel coverage",
        panels.length >= 4,
        "Dashboard contains at least four panels",
        panels.length,
        4
      ),
      assertion(
        "template variables",
        ["service", "environment"].every((name) =>
          variables.some((item) => (item as EvidenceRecord).name === name)
        ),
        "Dashboard is filterable by service and environment"
      )
    ];
  }
});

export const alertRulesGate = createEvidenceGate({
  type: "grafana.alert_rules",
  description: "Validate actionable alert rules.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    const rules = Array.isArray(value.rules)
      ? value.rules
      : Array.isArray(value.items)
        ? value.items
        : [];
    const enabled = rules.filter((rule) => (rule as EvidenceRecord).enabled === true);
    return [
      assertion(
        "enabled rules",
        enabled.length >= 2,
        "At least two alert rules are enabled",
        enabled.length,
        2
      ),
      assertion(
        "actionable metadata",
        enabled.every((rule) => {
          const item = rule as EvidenceRecord;
          return (
            typeof item.severity === "string" &&
            typeof item.owner === "string" &&
            typeof item.runbookUrl === "string"
          );
        }),
        "Enabled rules have severity, owner, and runbook metadata"
      )
    ];
  }
});

export const notificationPolicyGate = createEvidenceGate({
  type: "grafana.notification_policy",
  description: "Validate critical notification routing.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    return [
      assertion(
        "receiver",
        typeof value.receiver === "string" && value.receiver.length > 0,
        "Critical alerts have a receiver"
      ),
      assertion(
        "deployment mute",
        value.mutedDuringDeployment !== true,
        "Mute timing does not cover the deployment window"
      )
    ];
  }
});

export const sloDefinitionGate = createEvidenceGate({
  type: "grafana.slo_definition",
  description: "Validate the service SLO definition.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(_definition, value) {
    const objective = typeof value.objective === "number" ? value.objective : Number.NaN;
    return [
      assertion(
        "SLO objective",
        objective >= 99 && objective <= 100,
        "SLO objective is between 99 and 100 percent",
        objective
      ),
      assertion(
        "SLO window",
        typeof value.window === "string" && /(?:[7-9]|[1-9]\d+)d$/u.test(value.window),
        "SLO window is at least seven days",
        value.window
      ),
      assertion(
        "identity labels",
        value.labelsMatchIdentity === true,
        "SLO labels match canonical identity"
      )
    ];
  }
});
