import { assertion, createEvidenceGate, record } from "../../evaluation.js";

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

function nonempty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
function duration(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d|w)$/u.exec(value);
  return match === null
    ? Number.NaN
    : Number(match[1]) *
        ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2] ?? ""] ??
          Number.NaN);
}
export const dashboardGate = createEvidenceGate({
  type: "grafana.dashboard",
  description: "Validate configured service dashboard metadata and panel coverage.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const panels = Array.isArray(value.panels) ? value.panels : [];
    const variables = Array.isArray(value.variables) ? value.variables : [];
    const requiredVariables = Array.isArray(a.required_template_variables)
      ? a.required_template_variables
      : [];
    const requiredSignals = Array.isArray(a.required_panel_signals) ? a.required_panel_signals : [];
    const minimum = typeof a.minimum_panels === "number" ? a.minimum_panels : 0;
    return [
      assertion("dashboard exists", nonempty(value.uid), "Dashboard exists"),
      assertion(
        "panel coverage",
        panels.length >= minimum,
        "Dashboard meets the configured panel count",
        panels.length,
        minimum
      ),
      ...(typeof a.title_contains !== "string"
        ? []
        : [
            assertion(
              "dashboard title",
              typeof value.title === "string" && value.title.includes(a.title_contains),
              "Dashboard title contains the configured text",
              value.title,
              a.title_contains
            )
          ]),
      assertion(
        "panel signals",
        requiredSignals.every((signal) =>
          panels.some((panel) => {
            const item = record(panel) ?? {};
            return Array.isArray(item.signals) && item.signals.includes(signal);
          })
        ),
        "Dashboard panels cover every configured operational signal",
        panels.map((panel) => record(panel)?.signals),
        requiredSignals
      ),
      assertion(
        "template variables",
        requiredVariables.every((name) => variables.some((item) => record(item)?.name === name)),
        "Dashboard exposes every configured template variable",
        variables,
        requiredVariables
      )
    ];
  }
});
export const alertRulesGate = createEvidenceGate({
  type: "grafana.alert_rules",
  description: "Validate actionable alert rule configuration.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const rules = Array.isArray(value.rules)
      ? value.rules
      : Array.isArray(value.items)
        ? value.items
        : [];
    const enabled = rules.map((rule) => record(rule) ?? {}).filter((rule) => rule.enabled === true);
    const minimum = typeof a.minimum_enabled_rules === "number" ? a.minimum_enabled_rules : 0;
    return [
      assertion(
        "enabled rules",
        enabled.length >= minimum,
        "Enabled alert rule count meets the configured minimum",
        enabled.length,
        minimum
      ),
      ...(
        [
          ["require_severity_label", "severity"],
          ["require_owner_label", "owner"],
          ["require_runbook_annotation", "runbookUrl"]
        ] as const
      )
        .filter(([flag]) => a[flag] === true)
        .map(([flag, field]) =>
          assertion(
            flag,
            enabled.every((rule) => nonempty(rule[field])),
            "Enabled alert rules have the required metadata"
          )
        ),
      ...(a.forbid_no_data_ok_on_critical_rules !== true
        ? []
        : [
            assertion(
              "critical no-data behavior",
              enabled
                .filter((rule) => rule.severity === "critical")
                .every((rule) => typeof rule.noDataState === "string" && rule.noDataState !== "OK"),
              "Critical rules do not treat missing data as OK"
            )
          ])
    ];
  }
});
export const notificationPolicyGate = createEvidenceGate({
  type: "grafana.notification_policy",
  description: "Validate critical notification routing.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    return [
      assertion("receiver", nonempty(value.receiver), "Critical alerts have an effective receiver"),
      ...(a.receiver_is_configured !== true
        ? []
        : [
            assertion(
              "configured receiver",
              value.receiverConfigured === true,
              "Every effective receiver has a configured contact point"
            )
          ]),
      ...(a.mute_timing_does_not_cover_deployment_window === false
        ? []
        : [
            assertion(
              "deployment mute",
              value.mutedDuringDeployment === false,
              "No mute or inactive timing overlaps the deployment window"
            )
          ])
    ];
  }
});
export const sloDefinitionGate = createEvidenceGate({
  type: "grafana.slo_definition",
  description: "Validate the configured service SLO definition.",
  phases: ["pre_deployment"],
  providerRequirements: grafana,
  evaluate(definition, value) {
    const a = record(definition.assertions) ?? {};
    const bounds = record(a.objective_percent) ?? {};
    const objective = typeof value.objective === "number" ? value.objective : Number.NaN;
    const minimum = typeof bounds.minimum === "number" ? bounds.minimum : 0;
    const maximum = typeof bounds.maximum === "number" ? bounds.maximum : 100;
    const minimumWindow = record(a.window)?.minimum;
    return [
      ...(a.exists !== true ? [] : [assertion("SLO exists", nonempty(value.uid), "SLO exists")]),
      assertion(
        "SLO objective",
        objective >= minimum && objective <= maximum,
        "SLO objective meets the configured percentage bounds",
        objective,
        { minimum, maximum }
      ),
      ...(minimumWindow === undefined
        ? []
        : [
            assertion(
              "SLO window",
              duration(value.window) >= duration(minimumWindow),
              "SLO window meets the configured minimum duration",
              value.window,
              minimumWindow
            )
          ]),
      ...(a.indicator_query_is_valid !== true
        ? []
        : [
            assertion(
              "indicator query",
              value.indicatorQueryIsValid === true,
              "SLO indicator queries have been validated against their configured datasource"
            )
          ]),
      ...(a.labels_match_identity !== true
        ? []
        : [
            assertion(
              "identity labels",
              value.labelsMatchIdentity === true,
              "SLO labels match canonical identity"
            )
          ])
    ];
  }
});
