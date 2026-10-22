import { GateError, parseByteSize } from "@observability-gate/core";
import { gateContracts, type FieldContract } from "./gate-contracts.js";
import type { RawPolicy } from "./policy.js";
import { durationSchema } from "./common.js";

export function validateContract(value: unknown, contract: FieldContract, path: string): void {
  const fail = (message: string): never => {
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage: `${path}: ${message}`,
      retryable: false
    });
  };
  if (contract === "any") return;
  if (typeof contract === "string") {
    if (typeof value !== contract || (typeof value === "number" && !Number.isFinite(value)))
      fail(`Expected ${contract}.`);
    return;
  }
  if (Array.isArray(contract)) {
    if (!Array.isArray(value)) return fail("Expected an array.");
    for (const item of value) validateContract(item, contract[0] ?? "any", `${path}[]`);
    return;
  }
  const variants = (contract as { readonly anyOf?: readonly FieldContract[] }).anyOf;
  if (variants !== undefined) {
    for (const variant of variants) {
      try {
        validateContract(value, variant, path);
        return;
      } catch (error) {
        if (!(error instanceof GateError)) throw error;
      }
    }
    return fail("Value does not match a supported field contract.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return fail("Expected an object.");
  const fields = contract as Readonly<Record<string, FieldContract>>;
  for (const [key, item] of Object.entries(value)) {
    const expected = fields[key] ?? fields["*"];
    if (expected === undefined || ["__proto__", "constructor", "prototype"].includes(key))
      fail(`Unknown field ${key}.`);
    validateContract(item, expected as FieldContract, `${path}.${key}`);
  }
}

const authentication = {
  strategy: "string",
  bearer_token_env: "string",
  username_env: "string",
  password_env: "string",
  kubeconfig_env: "string",
  tenant_id_env: "string",
  client_id_env: "string",
  subscription_id_env: "string"
} as const;
const tls = { verify: "boolean" } as const;
const provider: FieldContract = {
  type: "string",
  endpoint: "string",
  endpoint_env: "string",
  request_timeout: "string",
  timeout: "string",
  authentication,
  tls,
  permissions: {
    mode: "string",
    required_verbs: ["string"],
    required_resources: ["string"],
    minimum_role: "string"
  },
  endpoints: { resource_manager: "string" },
  direct_host_access: "string",
  accepted_evidence: ["string"],
  files: ["string"],
  required: "boolean",
  required_in: ["string"],
  maximum_age: "string",
  provenance: { require_commit_sha: "boolean", require_workflow_run: "boolean" },
  signature: {
    required: "boolean",
    trusted_issuer: "string",
    trusted_issuer_env: "string",
    audience: "string",
    jwks_url: "string",
    jwks_url_env: "string",
    workflow_identity: "string",
    workflow_identity_env: "string",
    jwks_file: "string"
  },
  redirect_policy: "string",
  allowed_hosts: ["string"],
  evidence: { "*": "string" },
  queries: { "*": "string" },
  jwks_url: "string",
  jwks_url_env: "string"
};
const runtime: FieldContract = {
  type: "string",
  provider: "string",
  distribution: "string",
  operating_system: "string",
  context_env: "string",
  namespace_env: "string",
  workload: {
    kind: "string",
    name_env: "string",
    container_env: "string",
    name: "string",
    container: "string"
  },
  expected: {
    image_digest_env: "string",
    artifact_digest_env: "string",
    release_marker_env: "string",
    revision_suffix_env: "string",
    rollback_artifact: "string",
    rollback_artifact_env: "string",
    minimum_available_replicas: "number"
  },
  artifacts: {
    rendered_manifests: ["string"],
    rendered_configuration: ["string"],
    service_definition: ["string"],
    runtime_evidence: ["string"]
  },
  subscription_id_env: "string",
  resource_group_env: "string",
  application_name_env: "string",
  revision_name_env: "string",
  virtual_machine_name_env: "string",
  service_name_env: "string",
  host_group_env: "string",
  namespace: "string",
  context: "string",
  evidence_file: "string",
  expected_hosts: ["string"],
  subscription_id: "string",
  resource_group: "string",
  application_name: "string",
  revision_name: "string",
  virtual_machine_name: "string",
  service_name: "string",
  host_group: "string"
};
const security: FieldContract = {
  read_only: "boolean",
  prohibited_operations: ["string"],
  secrets: {
    forbid_in_configuration: "boolean",
    accepted_sources: ["string"],
    redact_environment_name_patterns: ["string"],
    redact_provider_headers: "boolean",
    redact_query_parameters: "boolean"
  },
  network: {
    allow_private_addresses: "boolean",
    allow_loopback: "boolean",
    allow_link_local: "boolean",
    allow_metadata_endpoints: "boolean",
    allowed_schemes: ["string"],
    provider_hosts_must_match_configured_endpoints: "boolean",
    http_probe_hosts_must_be_allowlisted: "boolean"
  },
  files: {
    workspace_only: "boolean",
    reject_symlinks_outside_workspace: "boolean",
    maximum_evidence_file_size: "string",
    reject_world_writable_evidence: "boolean"
  },
  evidence: {
    require_provenance_for_blocking_files: "boolean",
    hash_algorithm: "string",
    reject_stale_evidence: "boolean",
    reject_future_timestamps_beyond: "string"
  },
  commands: { shell_execution: "string", dynamic_plugins: "string" }
};
const reporting: FieldContract = {
  github: {
    check_run: {
      enabled: "boolean",
      name: "string",
      include: ["string"],
      annotations: { enabled: "boolean", maximum: "number" }
    },
    step_summary: { enabled: "boolean", sections: ["string"] },
    pull_request_comment: {
      enabled: "boolean",
      mode: "string",
      marker: "string",
      only_when: ["string"]
    }
  },
  artifacts: {
    directory: "string",
    formats: ["string"],
    retention_days: "number",
    include_raw_provider_responses: "boolean",
    include_evidence_hashes: "boolean"
  },
  outputs: ["string"],
  links: { "*": "string" }
};

export function validatePolicyContracts(policy: RawPolicy): void {
  for (const [name, definition] of Object.entries(policy.targets.definitions)) {
    const path = `targets.${name}.runtime`;
    validateContract(definition.runtime, runtime, path);
    validateRuntime(definition.runtime, path);
  }
  for (const [group, providers] of Object.entries(policy.providers)) {
    for (const [name, definition] of Object.entries(providers ?? {})) {
      const path = `providers.${group}.${name}`;
      validateContract(definition, provider, path);
      validateProvider(definition, group, path);
    }
  }
  validateContract(policy.security, security, "security");
  validateContract(policy.reporting, reporting, "reporting");
  validateSecurity(policy.security);
  validateReporting(policy.reporting);
  validateNestedSemantics(policy.limits, "limits");
  for (const [phase, gates] of Object.entries(policy.gates)) {
    for (const gate of gates) {
      const contract = gateContracts[gate.type];
      if (contract === undefined) continue;
      validateGate(gate, `${phase}.${gate.id}`);
      for (const key of [
        "source",
        "sources",
        "assertions",
        "selectors",
        "dependencies",
        "metrics",
        "candidate",
        "baseline",
        "when"
      ] as const) {
        if (gate[key] !== undefined)
          validateContract(gate[key], contract[key] ?? {}, `${phase}.${gate.id}.${key}`);
      }
    }
  }
}

type Data = Readonly<Record<string, unknown>>;
function data(value: unknown): Data {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Data)
    : {};
}
function invalid(path: string, message: string): never {
  throw new GateError({
    code: "CONFIG_SCHEMA",
    safeMessage: `${path}: ${message}`,
    retryable: false
  });
}
function choice(value: unknown, allowed: readonly string[], path: string, required = false): void {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || !allowed.includes(value))
    invalid(path, `Expected one of ${allowed.join(", ")}.`);
}
function choices(value: unknown, allowed: readonly string[], path: string, nonempty = true): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    (nonempty && value.length === 0) ||
    new Set(value).size !== value.length
  )
    invalid(path, "Expected a nonempty array of distinct supported values.");
  for (const item of value) choice(item, allowed, `${path}[]`, true);
}
function count(value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void {
  if (value === undefined) return;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid(path, `Expected an integer between ${minimum} and ${maximum}.`);
}
function requireString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.trim().length === 0)
    invalid(path, "Expected a nonempty string.");
}
function duration(value: unknown, path: string, positive = false): void {
  if (
    !durationSchema.safeParse(value).success ||
    (positive && Number.parseFloat(String(value)) <= 0)
  )
    invalid(path, "Expected a bounded duration.");
}
const operators = [
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "equal",
  "gt",
  "gte",
  "lt",
  "lte",
  "eq"
];
const units = [
  "percent",
  "ratio",
  "count",
  "seconds",
  "milliseconds",
  "bytes",
  "bytes_per_second",
  "requests_per_second",
  "events_per_second",
  "value"
];
const durations = new Set([
  "request_timeout",
  "timeout",
  "maximum_age",
  "short",
  "long",
  "maximum_latency",
  "maximum_data_age",
  "maximum_query_range",
  "maximum_evidence_age",
  "evaluation_window",
  "rollout_completed_within",
  "maximum_clock_skew",
  "maximum_future_skew",
  "reject_future_timestamps_beyond",
  "maximum_total_runtime",
  "startup_duration",
  "minimum_age_before_evaluation",
  "maximum_age_before_evaluation",
  "lookback",
  "maximum_extension",
  "current_health_window",
  "current_health_offset",
  "evidence_max_age",
  "warmup",
  "step",
  "settle_between_samples",
  "initial_backoff",
  "maximum_backoff"
]);
const bytes = new Set([
  "maximum_query_length",
  "maximum_provider_response_size",
  "maximum_report_size",
  "maximum_evidence_file_size"
]);
const traceIdentityKeys = [
  "resource.service.name",
  "resource.service.namespace",
  "resource.service.version",
  "resource.deployment.environment.name"
];
function query(value: unknown, path: string): void {
  if (typeof value === "string") return requireString(value, path);
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length === 0
  )
    invalid(path, "Expected a nonempty query string or trace identity selector.");
  for (const [key, item] of Object.entries(value)) {
    if (!traceIdentityKeys.includes(key)) invalid(path, "Unknown trace identity selector field.");
    requireString(item, `${path}.${key}`);
  }
}
function validateNestedSemantics(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNestedSemantics(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    const location = `${path}.${key}`;
    if (key === "query") query(item, location);
    if (key.endsWith("_query")) requireString(item, location);
    if (key === "operator") choice(item, operators, location, true);
    if (key === "unit") choice(item, units, location, true);
    if (durations.has(key)) {
      if (
        key === "maximum_age" &&
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item)
      ) {
        for (const [signal, limit] of Object.entries(item))
          duration(limit, `${location}.${signal}`);
      } else duration(item, location, key === "request_timeout" || key === "timeout");
    }
    if (key === "window" && typeof item === "string") duration(item, location);
    if (path.endsWith(".window") && (key === "minimum" || key === "maximum"))
      duration(item, location);
    if (key === "maximum_duration") {
      if (typeof item === "string") duration(item, location, true);
      else
        for (const [name, limit] of Object.entries(data(item)))
          duration(limit, `${location}.${name}`, true);
    }
    if (path.endsWith(".last_successful_export_age") && key === "less_than_or_equal")
      duration(item, location);
    if (bytes.has(key) && parseByteSize(item, -1) < 1)
      invalid(location, "Expected a positive byte count or B/KiB/MiB size.");
    if (
      /^(?:minimum|maximum|consecutive|required_consecutive)_(?:.*_)?(?:samples|requests|records|traces|replicas|instances|panels|rules|events|hosts)$/u.test(
        key
      )
    )
      if (typeof item === "number") count(item, location);
      else {
        const comparison = data(item);
        if (Object.keys(comparison).length === 0)
          invalid(location, "Expected a count or nonempty count comparison.");
        for (const [operator, limit] of Object.entries(comparison)) {
          choice(operator, operators, location, true);
          count(limit, `${location}.${operator}`);
        }
      }
    if (key.endsWith("_env")) {
      if (typeof item !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(item))
        invalid(location, "Expected an environment variable name.");
    }
    if (typeof item === "number" && !Number.isFinite(item))
      invalid(location, "Expected a finite number.");
    validateNestedSemantics(item, location);
  }
}
function validateRuntime(value: Data, path: string): void {
  choice(
    value.type,
    [
      "generic",
      "generic_vm",
      "kubernetes",
      "azure_container_apps",
      "azure_vm",
      "linux_vm",
      "windows_vm"
    ],
    `${path}.type`,
    true
  );
  requireString(value.provider, `${path}.provider`);
  choice(value.operating_system, ["linux", "windows"], `${path}.operating_system`);
  const workload = data(value.workload);
  choice(workload.kind, ["Deployment", "StatefulSet", "DaemonSet"], `${path}.workload.kind`);
  validateNestedSemantics(value, path);
}
const providerTypes: Readonly<Record<string, readonly string[]>> = {
  runtime: ["kubernetes", "azure_resource_manager", "evidence_only"],
  telemetry: ["prometheus", "mimir", "loki", "tempo", "grafana"],
  evidence: ["file", "json", "signed_json", "sarif", "otlp_capture", "junit_or_json"],
  http: ["http"]
};
function validateProvider(value: Data, group: string, path: string): void {
  choice(value.type, providerTypes[group] ?? [], `${path}.type`, true);
  if (data(value.tls).verify === false)
    invalid(`${path}.tls.verify`, "TLS verification cannot be disabled.");
  const permissions = data(value.permissions);
  choice(permissions.mode, ["read_only"], `${path}.permissions.mode`);
  choices(
    permissions.required_verbs,
    ["get", "list", "watch"],
    `${path}.permissions.required_verbs`
  );
  choice(permissions.minimum_role, ["Reader"], `${path}.permissions.minimum_role`);
  choice(value.direct_host_access, ["forbidden"], `${path}.direct_host_access`);
  choice(value.redirect_policy, ["same_origin"], `${path}.redirect_policy`);
  choices(value.required_in, ["pre_deployment", "post_deployment"], `${path}.required_in`);
  const auth = data(value.authentication);
  choice(
    auth.strategy,
    ["ambient_or_kubeconfig", "workload_identity", "bearer_token", "ambient"],
    `${path}.authentication.strategy`
  );
  if (auth.username_env !== undefined || auth.password_env !== undefined)
    invalid(
      `${path}.authentication`,
      "Password authentication is unsupported; use bearer-token or ambient identity."
    );
  if (data(value.signature).required === false)
    invalid(`${path}.signature.required`, "Signature verification cannot be disabled.");
  for (const key of ["endpoint", "jwks_url"] as const) {
    const endpoint = value[key];
    if (
      endpoint === undefined ||
      (typeof endpoint === "string" && /^\$\{[A-Z][A-Z0-9_]*\}$/u.test(endpoint))
    )
      continue;
    let url: URL;
    try {
      url = new URL(String(endpoint));
    } catch {
      invalid(`${path}.${key}`, "Expected an HTTPS URL.");
    }
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0)
      invalid(`${path}.${key}`, "Expected an HTTPS URL without inline credentials.");
  }
  validateNestedSemantics(value, path);
}
function mustRemainTrue(value: Data, keys: readonly string[], path: string): void {
  for (const key of keys)
    if (value[key] === false)
      invalid(`${path}.${key}`, "This safety invariant cannot be disabled.");
}
function validateSecurity(value: Data): void {
  mustRemainTrue(value, ["read_only"], "security");
  const secrets = data(value.secrets),
    network = data(value.network),
    files = data(value.files),
    evidence = data(value.evidence),
    commands = data(value.commands);
  mustRemainTrue(
    secrets,
    ["forbid_in_configuration", "redact_provider_headers", "redact_query_parameters"],
    "security.secrets"
  );
  choices(
    secrets.accepted_sources,
    ["environment", "oidc", "ambient_identity"],
    "security.secrets.accepted_sources"
  );
  mustRemainTrue(
    network,
    ["provider_hosts_must_match_configured_endpoints", "http_probe_hosts_must_be_allowlisted"],
    "security.network"
  );
  if (network.allow_metadata_endpoints === true)
    invalid("security.network.allow_metadata_endpoints", "Cloud metadata endpoints are forbidden.");
  choices(network.allowed_schemes, ["https"], "security.network.allowed_schemes");
  mustRemainTrue(
    files,
    ["workspace_only", "reject_symlinks_outside_workspace", "reject_world_writable_evidence"],
    "security.files"
  );
  mustRemainTrue(
    evidence,
    ["require_provenance_for_blocking_files", "reject_stale_evidence"],
    "security.evidence"
  );
  choice(evidence.hash_algorithm, ["sha256"], "security.evidence.hash_algorithm");
  choice(commands.shell_execution, ["forbidden"], "security.commands.shell_execution");
  choice(commands.dynamic_plugins, ["forbidden"], "security.commands.dynamic_plugins");
  validateNestedSemantics(value, "security");
}
const outputNames = [
  "decision",
  "phase",
  "target_id",
  "release_id",
  "baseline_release_id",
  "passed_count",
  "warned_count",
  "failed_count",
  "skipped_count",
  "evidence_coverage_percent",
  "report_path"
];
function validateReporting(value: Data): void {
  const github = data(value.github),
    check = data(github.check_run),
    annotations = data(check.annotations),
    summary = data(github.step_summary),
    comment = data(github.pull_request_comment),
    artifacts = data(value.artifacts);
  choices(
    check.include,
    [
      "final_decision",
      "phase",
      "target",
      "release",
      "gate_summary",
      "failed_assertions",
      "evidence_age",
      "remediation"
    ],
    "reporting.github.check_run.include"
  );
  choices(
    summary.sections,
    [
      "decision",
      "identity",
      "target",
      "evidence_coverage",
      "blocking_gates",
      "advisory_gates",
      "skipped_gates",
      "comparisons",
      "links"
    ],
    "reporting.github.step_summary.sections"
  );
  count(annotations.maximum, "reporting.github.check_run.annotations.maximum", 1, 50);
  choice(comment.mode, ["update_single_comment"], "reporting.github.pull_request_comment.mode");
  choices(
    comment.only_when,
    ["pull_request", "pull_request_target"],
    "reporting.github.pull_request_comment.only_when"
  );
  if (
    comment.marker !== undefined &&
    (typeof comment.marker !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(comment.marker))
  )
    invalid(
      "reporting.github.pull_request_comment.marker",
      "Expected a safe comment marker of at most 128 characters."
    );
  choices(artifacts.formats, ["json", "junit", "sarif", "markdown"], "reporting.artifacts.formats");
  count(artifacts.retention_days, "reporting.artifacts.retention_days", 1, 90);
  if (artifacts.include_raw_provider_responses === true)
    invalid(
      "reporting.artifacts.include_raw_provider_responses",
      "Raw provider responses cannot be published."
    );
  if (artifacts.include_evidence_hashes === false)
    invalid(
      "reporting.artifacts.include_evidence_hashes",
      "Evidence hashes are part of the canonical report contract."
    );
  choices(value.outputs, outputNames, "reporting.outputs");
  if (Array.isArray(value.outputs) && value.outputs.length !== outputNames.length)
    invalid(
      "reporting.outputs",
      "The public outputs contract requires the complete canonical output set."
    );
}
function validateGate(gate: Data, path: string): void {
  const assertions = data(gate.assertions),
    source = data(gate.source);
  if (gate.type === "metric.threshold") {
    if (gate.assertions === undefined)
      invalid(`${path}.assertions`, "Metric thresholds require operator and threshold assertions.");
    choice(assertions.operator, operators, `${path}.assertions.operator`, true);
    if (typeof assertions.threshold !== "number" || !Number.isFinite(assertions.threshold))
      invalid(`${path}.assertions.threshold`, "Expected a finite numeric threshold.");
    if (source.query === undefined)
      invalid(`${path}.source.query`, "Metric thresholds require an explicit query.");
    if (typeof source.query !== "string")
      invalid(`${path}.source.query`, "Metric thresholds require a query string.");
    if (assertions.unit === "percent" && (assertions.threshold < 0 || assertions.threshold > 100))
      invalid(`${path}.assertions.threshold`, "Percent thresholds must be between 0 and 100.");
    if (assertions.unit === "ratio" && (assertions.threshold < 0 || assertions.threshold > 1))
      invalid(`${path}.assertions.threshold`, "Ratio thresholds must be between 0 and 1.");
  }
  if (gate.type === "synthetic.result") {
    const required = assertions.required_tests;
    if (
      !Array.isArray(required) ||
      required.length === 0 ||
      required.some((item) => typeof item !== "string" || item.trim().length === 0) ||
      new Set(required).size !== required.length
    )
      invalid(
        `${path}.assertions.required_tests`,
        "Synthetic results require nonempty distinct named test requirements."
      );
  }
  if (source.adapter !== undefined) choice(source.adapter, ["active"], `${path}.source.adapter`);
  validateNestedSemantics(gate, path);
}
