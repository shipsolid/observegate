import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { parsePolicy, createExecutionPlan } from "../src/index.js";
import type { GateCatalogMetadata } from "@observability-gate/core";

type Policy = ReturnType<typeof parsePolicy>;

async function minimal(): Promise<Policy> {
  return parse(await readFile("fixtures/configs/minimal-valid.yml", "utf8"));
}

describe("complete policy validation", () => {
  it.each([
    [
      "provider authentication",
      (p: Policy) => {
        p.providers.telemetry = {
          metrics: { type: "prometheus", authentication: { bearer_tokn_env: "TOKEN" } }
        };
      }
    ],
    [
      "runtime workload",
      (p: Policy) => {
        p.targets.definitions.test!.runtime.workload = { kind: "Deployment", naem_env: "WORKLOAD" };
      }
    ],
    [
      "gate assertions",
      (p: Policy) => {
        p.gates.post_deployment[0] = {
          id: "metric",
          name: "Metric",
          type: "metric.threshold",
          assertions: { threshhold: 1 }
        };
      }
    ],
    [
      "security network",
      (p: Policy) => {
        p.security.network = { allowd_hosts: [] };
      }
    ],
    [
      "duration",
      (p: Policy) => {
        p.execution.phases.pre_deployment.timeout = "forever";
      }
    ],
    [
      "decision mapping",
      (p: Policy) => {
        p.decision.outcomes.fail.exit_code = 42;
      }
    ]
  ] as const)("rejects invalid %s fields", async (_name, mutate) => {
    const policy = await minimal();
    mutate(policy);
    expect(() => parsePolicy(stringify(policy))).toThrowError(
      expect.objectContaining({ code: "CONFIG_SCHEMA" })
    );
  });

  it.each([
    [
      "unimplemented metric operator",
      (p: Policy) => {
        p.gates.post_deployment[0]!.assertions!.operator = "not_equals";
      }
    ],
    [
      "invalid query descriptor",
      (p: Policy) => {
        p.gates.post_deployment[0]!.source!.queries = { cpu: { candiate: "up" } };
      }
    ],
    [
      "invalid probe descriptor",
      (p: Policy) => {
        p.gates.post_deployment[0]!.source!.probes = { metrics: { qurey: "up" } };
      }
    ],
    [
      "object condition",
      (p: Policy) => {
        p.gates.post_deployment[0]!.when = { runtime_type: { type: "kubernetes" } };
      }
    ],
    [
      "unknown nested dependency assertion",
      (p: Policy) => {
        p.gates.post_deployment[0] = {
          id: "dep",
          name: "Dependency",
          type: "dependency.health",
          dependencies: [
            {
              name: "peer",
              source: { provider: "metrics", query: "up" },
              assertions: { threshhold: 1 }
            }
          ]
        };
      }
    ],
    [
      "disabled evidence hashes",
      (p: Policy) => {
        p.reporting.artifacts = { include_evidence_hashes: false };
      }
    ],
    [
      "invalid retention",
      (p: Policy) => {
        p.reporting.artifacts = { retention_days: 91 };
      }
    ],
    [
      "unsupported redirect policy",
      (p: Policy) => {
        p.providers.http = { probe: { type: "http", redirect_policy: "allowlisted" } };
      }
    ],
    [
      "missing metric assertions",
      (p: Policy) => {
        delete p.gates.post_deployment[0]!.assertions;
      }
    ],
    [
      "missing metric operator",
      (p: Policy) => {
        delete p.gates.post_deployment[0]!.assertions!.operator;
      }
    ],
    [
      "unknown metric operator",
      (p: Policy) => {
        p.gates.post_deployment[0]!.assertions!.operator = "approximately";
      }
    ],
    [
      "nonnumeric threshold",
      (p: Policy) => {
        p.gates.post_deployment[0]!.assertions!.threshold = "high";
      }
    ],
    [
      "negative sample count",
      (p: Policy) => {
        p.gates.post_deployment[0]!.assertions!.minimum_samples = -1;
      }
    ],
    [
      "fractional request count",
      (p: Policy) => {
        p.gates.post_deployment[0]!.assertions!.minimum_requests = 1.5;
      }
    ],
    [
      "numeric query",
      (p: Policy) => {
        p.gates.post_deployment[0]!.source!.query = 42;
      }
    ],
    [
      "unknown trace query field",
      (p: Policy) => {
        p.gates.post_deployment[0]!.source!.query = { unknown: "value" };
      }
    ],
    [
      "nonstring trace identity",
      (p: Policy) => {
        p.gates.post_deployment[0]!.source!.query = { "resource.service.name": 42 };
      }
    ],
    [
      "empty synthetic requirements",
      (p: Policy) => {
        p.gates.post_deployment[0] = {
          id: "synthetic",
          name: "Synthetic",
          type: "synthetic.result",
          source: { provider: "local" },
          assertions: { required_tests: [] }
        };
      }
    ],
    [
      "missing synthetic requirements",
      (p: Policy) => {
        p.gates.post_deployment[0] = {
          id: "synthetic",
          name: "Synthetic",
          type: "synthetic.result",
          source: { provider: "local" }
        };
      }
    ],
    [
      "duplicate synthetic requirements",
      (p: Policy) => {
        p.gates.post_deployment[0] = {
          id: "synthetic",
          name: "Synthetic",
          type: "synthetic.result",
          source: { provider: "local" },
          assertions: { required_tests: ["health", "health"] }
        };
      }
    ],
    [
      "unknown runtime type",
      (p: Policy) => {
        p.targets.definitions.test!.runtime.type = "magic_cloud";
      }
    ],
    [
      "unknown provider type",
      (p: Policy) => {
        p.providers.telemetry = { metrics: { type: "magic_metrics" } };
      }
    ],
    [
      "invalid provider timeout",
      (p: Policy) => {
        p.providers.telemetry = { metrics: { type: "prometheus", request_timeout: "forever" } };
      }
    ],
    [
      "zero provider timeout",
      (p: Policy) => {
        p.providers.telemetry = { metrics: { type: "prometheus", request_timeout: "0ms" } };
      }
    ],
    [
      "disabled TLS verification",
      (p: Policy) => {
        p.providers.telemetry = { metrics: { type: "prometheus", tls: { verify: false } } };
      }
    ],
    [
      "mutating runtime permissions",
      (p: Policy) => {
        p.providers.runtime = {
          runtime: {
            type: "kubernetes",
            permissions: { mode: "read_only", required_verbs: ["get", "patch"] }
          }
        };
      }
    ],
    [
      "invalid authentication strategy",
      (p: Policy) => {
        p.providers.telemetry = {
          metrics: { type: "prometheus", authentication: { strategy: "interactive_password" } }
        };
      }
    ],
    [
      "disabled read-only boundary",
      (p: Policy) => {
        p.security.read_only = false;
      }
    ],
    [
      "shell execution",
      (p: Policy) => {
        p.security.commands = { shell_execution: "allowed" };
      }
    ],
    [
      "dynamic plugins",
      (p: Policy) => {
        p.security.commands = { dynamic_plugins: "allowed" };
      }
    ],
    [
      "metadata endpoints",
      (p: Policy) => {
        p.security.network = { allow_metadata_endpoints: true };
      }
    ],
    [
      "insecure schemes",
      (p: Policy) => {
        p.security.network = { allowed_schemes: ["http"] };
      }
    ],
    [
      "disabled host binding",
      (p: Policy) => {
        p.security.network = { provider_hosts_must_match_configured_endpoints: false };
      }
    ],
    [
      "uncontained evidence files",
      (p: Policy) => {
        p.security.files = { workspace_only: false };
      }
    ],
    [
      "invalid evidence size",
      (p: Policy) => {
        p.security.files = { maximum_evidence_file_size: "many" };
      }
    ],
    [
      "invalid timestamp skew",
      (p: Policy) => {
        p.security.evidence = { reject_future_timestamps_beyond: "tomorrow" };
      }
    ],
    [
      "disabled redaction",
      (p: Policy) => {
        p.security.secrets = { redact_provider_headers: false };
      }
    ],
    [
      "unsupported hash",
      (p: Policy) => {
        p.security.evidence = { hash_algorithm: "md5" };
      }
    ],
    [
      "unknown report format",
      (p: Policy) => {
        p.reporting.artifacts = { formats: ["html"] };
      }
    ],
    [
      "empty report formats",
      (p: Policy) => {
        p.reporting.artifacts = { formats: [] };
      }
    ],
    [
      "unknown check selection",
      (p: Policy) => {
        p.reporting.github = { check_run: { include: ["everything"] } };
      }
    ],
    [
      "unknown summary section",
      (p: Policy) => {
        p.reporting.github = { step_summary: { sections: ["everything"] } };
      }
    ],
    [
      "unsafe comment marker",
      (p: Policy) => {
        p.reporting.github = { pull_request_comment: { marker: "bad --> injected <!--" } };
      }
    ],
    [
      "unsupported comment mode",
      (p: Policy) => {
        p.reporting.github = { pull_request_comment: { mode: "append" } };
      }
    ],
    [
      "excess annotations",
      (p: Policy) => {
        p.reporting.github = { check_run: { annotations: { maximum: 51 } } };
      }
    ],
    [
      "zero annotations",
      (p: Policy) => {
        p.reporting.github = { check_run: { annotations: { maximum: 0 } } };
      }
    ],
    [
      "unsupported artifact response exposure",
      (p: Policy) => {
        p.reporting.artifacts = { include_raw_provider_responses: true };
      }
    ],
    [
      "invalid byte ceiling",
      (p: Policy) => {
        p.limits.maximum_query_length = "unbounded";
      }
    ],
    [
      "negative byte ceiling",
      (p: Policy) => {
        p.limits.maximum_report_size = -1;
      }
    ]
  ] as const)("rejects unsafe or meaningless %s semantics", async (_name, mutate) => {
    const p = await minimal();
    p.providers.telemetry = { metrics: { type: "prometheus" } };
    p.gates.post_deployment = [
      {
        id: "metric",
        name: "Metric",
        type: "metric.threshold",
        source: { provider: "metrics", query: "up" },
        assertions: { operator: "greater_than_or_equal", threshold: 1, minimum_samples: 1 }
      }
    ];
    mutate(p);
    expect(() => parsePolicy(stringify(p))).toThrowError(
      expect.objectContaining({ code: "CONFIG_SCHEMA" })
    );
  });

  it("accepts supported threshold equality and strictly typed comparison queries", async () => {
    const p = await minimal();
    p.providers.telemetry = { metrics: { type: "prometheus" } };
    p.gates.post_deployment = [
      {
        id: "metric",
        name: "Metric",
        type: "metric.threshold",
        source: { provider: "metrics", query: "up" },
        assertions: { operator: "equal", threshold: 1 }
      }
    ];
    expect(parsePolicy(stringify(p)).gates.post_deployment[0]?.assertions?.operator).toBe("equal");
    p.gates.post_deployment = [
      {
        id: "comparison",
        name: "Comparison",
        type: "comparison.multi_metric",
        source: {
          provider: "metrics",
          queries: {
            cpu: {
              candidate: { query: "candidate_cpu", request_count_query: "candidate_requests" },
              baseline: { query: "baseline_cpu", request_count_query: "baseline_requests" },
              unit: "seconds"
            }
          }
        },
        assertions: {
          minimum_candidate_samples: 1,
          minimum_baseline_samples: 1,
          maximum_absolute_regression: 1,
          maximum_relative_regression_percent: 10
        }
      }
    ];
    expect(() => parsePolicy(stringify(p))).not.toThrow();
  });

  it("preserves exhaustive structural policies and environment placeholders", async () => {
    const text = await readFile("examples/observability-gate.yml", "utf8");
    expect(parsePolicy(text).execution.active_target).toBe("${TARGET_ID}");
  });

  it("enforces the configured gate limit before execution", async () => {
    const value = await minimal();
    value.limits.maximum_gates = 1;
    value.gates.pre_deployment = [
      { id: "one", name: "One", type: "identity.contract" },
      { id: "two", name: "Two", type: "identity.contract" }
    ];
    const policy = parsePolicy(stringify(value));
    const catalog: GateCatalogMetadata = {
      "identity.contract": {
        type: "identity.contract",
        description: "Identity",
        supportedPhases: ["pre_deployment"],
        providerRequirements: [],
        conditionKeys: [],
        assertionSchema: "identity",
        supportsRemediation: true
      }
    };
    expect(() => createExecutionPlan({ policy, phase: "pre_deployment", catalog })).toThrowError(
      expect.objectContaining({ code: "CONFIG_SCHEMA" })
    );
  });
});
