// Verify closed review findings without network access or production mutations.
// Run after npm run build: node tests/manual/product-completeness-review.mjs
/* global AbortController */
import assert from "node:assert/strict";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { EvidenceStore } from "@observability-gate/core";
import { parsePolicy } from "@observability-gate/config";
import { createBuiltInGateCatalog } from "@observability-gate/gates";
import { normalizeAlertRules, parseKubernetesManifest } from "@observability-gate/providers";

const catalog = createBuiltInGateCatalog();
const context = {
  phase: "pre_deployment",
  targetId: "review",
  evidenceStore: new EvidenceStore(),
  signal: new AbortController().signal,
  clock: () => new Date(),
  missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
};

function evaluate(type, assertions, value, phase = "pre_deployment") {
  const scoped = { ...context, phase };
  return catalog.require(type, phase, { assertions }).evaluate(
    [
      {
        id: "review-evidence",
        kind: type,
        state: "valid",
        source: { provider: "review", capability: type },
        target: context.targetId,
        acquiredAt: context.clock().toISOString(),
        value,
        diagnostics: []
      }
    ],
    scoped
  );
}

const allPassed = (assertions) => assertions.every((item) => item.status === "passed");
const dashboard = evaluate(
  "grafana.dashboard",
  {
    minimum_panels: 8,
    title_contains: "checkout",
    required_panel_signals: ["traffic", "errors", "latency", "saturation"],
    required_template_variables: ["service", "environment", "cluster"]
  },
  {
    uid: "wrong-dashboard",
    title: "Unrelated dashboard",
    titleMatches: false,
    panels: Array.from({ length: 4 }, (_, index) => ({ id: index, signal: "unknown" })),
    variables: [{ name: "service" }, { name: "environment" }]
  }
);
const alertRules = evaluate(
  "grafana.alert_rules",
  { minimum_enabled_rules: 5 },
  {
    rules: Array.from({ length: 2 }, () => ({
      enabled: true,
      severity: "critical",
      owner: "review",
      runbookUrl: "https://example.test/runbook"
    }))
  }
);
const budgetAssertions = { new_metric_series: { less_than_or_equal: 500 } };
const budget = evaluate("telemetry.cardinality_estimate", budgetAssertions, {
  measurements: { new_metric_series: 100 }
});
const base = parsePolicy(await readFile("examples/offline.yml", "utf8"));
base.providers.telemetry = {
  metrics: { type: "prometheus", endpoint: "https://metrics.example.test" }
};
base.gates.pre_deployment = [
  {
    id: "review.budget",
    name: "Review budget",
    type: "telemetry.cardinality_estimate",
    enforcement: "advisory",
    source: { provider: "metrics", queries: { new_metric_series: "projected_series" } },
    assertions: budgetAssertions
  }
];
assert.doesNotThrow(() => parsePolicy(JSON.stringify(base)));
base.gates.pre_deployment[0].assertions.budget = 500;
let budgetRejection;
try {
  parsePolicy(JSON.stringify(base));
} catch (error) {
  budgetRejection = error.message;
}

const manifest = parseKubernetesManifest(
  JSON.stringify({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "checkout", namespace: "review" },
    spec: {
      replicas: 2,
      selector: { matchLabels: { app: "checkout" } },
      template: {
        metadata: { labels: { app: "checkout" } },
        spec: {
          containers: [
            {
              name: "sidecar",
              image: "sidecar:good",
              resources: {
                requests: { cpu: "100m", memory: "64Mi" },
                limits: { cpu: "200m", memory: "128Mi" }
              }
            },
            { name: "checkout", image: "checkout:bad" }
          ]
        }
      }
    }
  }) +
    "\n---\n" +
    JSON.stringify({
      apiVersion: "policy/v1",
      kind: "PodDisruptionBudget",
      metadata: { name: "unrelated", namespace: "review" },
      spec: { minAvailable: 1, selector: { matchLabels: { app: "another-service" } } }
    }),
  { kind: "Deployment", name: "checkout", namespace: "review", container: "checkout" }
);
const resources = evaluate("kubernetes.resources", {}, { ...manifest, production: true });
const rollout = evaluate(
  "kubernetes.rollout_status",
  {},
  {
    workloadKind: "StatefulSet",
    rollout: {
      currentRevision: "rev-1",
      updateRevision: "rev-1",
      generationObserved: true,
      conditions: [],
      replicas: { desired: 2, updated: 2, available: 2, unavailable: 0 },
      durationMs: 1,
      maximumDurationMs: 1000
    }
  },
  "post_deployment"
);

const provisioningRules = [
  {
    uid: "review-rule",
    title: "Checkout errors",
    orgID: 1,
    folderUID: "review",
    ruleGroup: "review",
    condition: "A",
    data: [],
    for: "5m",
    noDataState: "NoData",
    execErrState: "Alerting",
    isPaused: false,
    labels: { service: "checkout", owner: "review", severity: "critical" },
    annotations: { runbook_url: "https://example.test/runbook" },
    updated: new Date().toISOString()
  }
];

// A healthy fixture is the control; policy and evidence violations must fail.
assert.equal(
  allPassed(
    evaluate(
      "grafana.dashboard",
      {},
      {
        uid: "control",
        panels: [{}, {}, {}, {}],
        variables: [{ name: "service" }, { name: "environment" }]
      }
    )
  ),
  true
);
assert.equal(allPassed(dashboard), false);
assert.equal(allPassed(alertRules), false);
assert.equal(budget[0].status, "passed");
assert.equal(budget[0].expected, 500);
assert.match(budgetRejection, /budget/u);
assert.equal(manifest.image, "checkout:bad");
assert.equal(manifest.disruptionBudget, undefined);
assert.equal(allPassed(resources), false);
assert.equal(allPassed(rollout), true);
assert.equal(normalizeAlertRules(provisioningRules, {}).length, 1);

process.stdout.write(
  JSON.stringify(
    {
      dashboardViolatingPolicyPassed: allPassed(dashboard),
      twoRulesAgainstMinimumFivePassed: allPassed(alertRules),
      estimate100AgainstLimit500: budget[0],
      runtimeBudgetFieldRejected: budgetRejection,
      selectedContainerImage: manifest.image,
      unrelatedDisruptionBudgetAccepted: allPassed(resources),
      healthyReplicaCountsWithoutDeploymentConditions: rollout.filter(
        (item) => item.status !== "passed"
      ),
      documentedProvisioningRuleAccepted: normalizeAlertRules(provisioningRules, {}).length === 1
    },
    null,
    2
  ) + "\n"
);
