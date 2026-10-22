import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { configurationFields, policyJsonSchema } from "../packages/config/dist/index.js";
import { errorCodes } from "../packages/core/dist/index.js";
import { createBuiltInGateCatalog } from "../packages/gates/dist/index.js";
import { providerCapabilities } from "../packages/providers/dist/index.js";

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function configurationDocument(): string {
  const rows = configurationFields.map((field) =>
    [
      field.path,
      field.type,
      field.required ? "yes" : "no",
      field.defaultValue ?? "—",
      field.allowedValues?.join(", ") ?? "—",
      field.description
    ]
      .map(cell)
      .join(" | ")
  );
  return `# Configuration reference

ObserveGate accepts one strict YAML policy with no top-level schema-version field. Unknown fields,
duplicate keys, YAML aliases, and merge keys are rejected. Interpolation supports only
\`\${VARIABLE_NAME}\` and is limited to the active target and selected phase.

Durations use \`ms\`, \`s\`, \`m\`, \`h\`, or \`d\`. Secrets must come from environment variables,
OIDC, or ambient identity; never place credential values in the policy.

Use \`observability-gate schema --json\` or the generated [policy JSON Schema](observability-gate.schema.json)
for editor validation. Runtime validation additionally checks references, acquisition contracts,
supported semantic values, and workspace/network security; structural schema validation alone is insufficient.

| Field path | Type | Required | Default | Allowed values | Meaning |
| --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row} |`).join("\n")}
`;
}

function gateDocument(): string {
  const metadata = Object.values(createBuiltInGateCatalog().metadata()).sort((left, right) =>
    left.type.localeCompare(right.type)
  );
  const conditionKeys = [...new Set(metadata.flatMap((gate) => [...gate.conditionKeys]))].sort();
  const rows = metadata.map((gate) => {
    const providers = gate.providerRequirements
      .map((item) => `${item.provider}:${item.capability}${item.required ? "" : " (optional)"}`)
      .join(", ");
    return `| ${cell(gate.type)} | ${gate.supportedPhases.join(", ")} | ${cell(providers || "none")} | ${cell(gate.assertionSchema)} | ${gate.supportsRemediation ? "yes" : "no"} | ${cell(gate.description)} |`;
  });
  return `# Gate catalogue

The built-in catalogue contains ${metadata.length} gate types. Configuration order is preserved in
results; decision aggregation itself is order-independent. Conditions are limited to
${conditionKeys.map((key) => `\`${key}\``).join(", ")}.

| Gate type | Phases | Provider requirements | Assertion schema | Remediation | Purpose |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
}

function providerDocument(): string {
  const rows = providerCapabilities.flatMap((provider) =>
    provider.implementations.map(
      (implementation) =>
        `| ${cell(provider.family)} | ${cell(implementation)} | ${cell(provider.capabilities.join(", "))} | ${cell(provider.authentication)} | ${provider.readOnly ? "yes" : "no"} |`
    )
  );
  return `# Provider reference

Providers acquire and normalize evidence only. They do not deploy, scale, restart, change traffic,
or mutate observability resources. Network providers share guarded HTTPS transport, bounded response
sizes, explicit retry policies, cancellation, and SSRF controls.

| Family | Implementation | Capabilities | Authentication | Read-only |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

## Configuring acquisition

Use \`observability-gate explain <gate-type> --json\` for each gate's accepted source and assertion
fields. Both \`validate\` and \`plan\` reject incomplete acquisition contracts without contacting providers.
The exhaustive reference YAML demonstrates policy structure; it must be completed with workload-specific
queries, artifacts, and identities. Start with \`examples/offline.yml\` for a runnable local policy.

- Telemetry providers use canonical keys \`metrics\`, \`logs\`, \`traces\`, and \`grafana\`; provider types must match those capabilities.
- Metric assertions require explicit backend queries. Traffic counts and baseline/candidate measurements
  require independent queries; vector length is never treated as request volume. Scalar contracts require
  one finite series; range contracts evaluate the actual returned samples.
- Comparison sources require distinct candidate and baseline release IDs and explicit queries for each.
  Supply an explicit baseline release rather than assuming that the backend can discover a previous healthy release.
- Baseline strategy is \`explicit\`; automatic release discovery, lookback filtering, incident/deployment exclusions,
  and automatic low-traffic extension are unsupported and reject instead of being ignored. Scalar instant
  comparisons contribute one sample per query; request counts require independent count queries.
- Cardinality estimates require one \`source.queries\` entry per configured dimension:
  \`new_metric_series\`, \`new_log_attribute_keys\`, \`new_span_attribute_keys\`, or
  \`estimated_series_growth_percent\`. Volume estimates use \`metrics\`, \`logs\`, and \`traces\` growth
  percentages. Counts are non-negative integers; percentages are non-negative finite numbers. These gates are advisory.
- Grafana alert readiness reads provisioned configuration and runbook annotations, while active-alert state
  comes from a separate endpoint. SLO definitions use one objective and key/value labels; SLO health and
  remaining budget require measured \`source.queries.status\` (1=met, 0=unmet) and \`remaining_percent\`.
  Indicator validation supports ratio/freeform definitions with an explicit datasource UID.
- Notification routes resolve nested/default/inherited receivers and continue branches. Regex/legacy matchers,
  unknown selector labels, and recurring mute/active schedules yield insufficient evidence until supported;
  an unresolved schedule cannot prove the deployment window is unmuted.
- Runtime gates require a compatible active target. Kubernetes uses one kubeconfig (including a configured
  \`authentication.kubeconfig_env\`) or an in-cluster service account; command-based credential plugins and
  disabled TLS verification are rejected. Azure uses environment, workload, or managed identity credentials.
- VM guest facts require \`runtime.expected_hosts\` and workspace-contained JSON files in
  \`runtime.artifacts.runtime_evidence\`; Azure control-plane state does not prove guest service health.
- Container Apps lifecycle and restart checks require explicit telemetry queries. A revision snapshot alone
  cannot establish historical restart or stability assertions.
- Signed deployment evidence requires a compact JWS, trusted workspace JWKS, compatible algorithm/key,
  exact release identity, and fresh deployment completion. See [deployment evidence](deployment-evidence.md).

## Compatibility evidence

| Provider | Contract exercised locally | Live certification |
| --- | --- | --- |
| Prometheus/Mimir | v1 query/query_range vector and matrix shapes; malformed/stale/failure cases | Not run in this checkout |
| Loki | v1 query_range stream shape and bounded requests | Not run in this checkout |
| Tempo | Bounded trace search and identity-object contract | Not run in this checkout |
| Grafana | Documented alert provisioning, dashboard, routing/contact-point and SLO definition shapes; explicit reliability queries | Not run in this checkout |
| Kubernetes | apps/v1 Deployment, StatefulSet, DaemonSet; policy/v1 PDB selectors; multi-container evidence | Local kind Kubernetes v1.37.0: three real API/rollout cases passed; AKS certification still required |
| Azure Container Apps/VM | Pinned SDK read adapters and synthetic response contracts | Protected opt-in Azure job; no live certification recorded here |
| Linux/Windows VMs | Bounded workspace guest evidence plus signed deployment identity | User-owned collection; no host sessions |

These are contract tests, not an assertion that all deployed vendor versions are compatible.
Run the protected live jobs against the exact release and versions before declaring an environment supported.

## Provider failure semantics

- Authentication and authorization failures are not retried.
- Only configured transient timeouts, connection resets, 429, 502, 503, and 504 responses retry.
- Required provider failure yields an \`error\` decision; absence of evidence is classified separately.
- Identical evidence requests are deduplicated in memory for one execution.
`;
}

const troubleshooting: Readonly<Record<string, readonly [string, string, string]>> = {
  CONFIG_SYNTAX: [
    "The YAML cannot be parsed safely.",
    "Duplicate keys, malformed YAML, aliases, or merge keys.",
    "Fix the YAML; do not enable aliases or merges."
  ],
  CONFIG_SCHEMA: [
    "The policy does not match the strict schema.",
    "Unknown fields, invalid values, or missing environment variables.",
    "Run `observability-gate validate --config <path>` and correct every reported field."
  ],
  CONFIG_REFERENCE: [
    "A named target, provider, gate, or output cannot be resolved.",
    "Misspelled IDs or incompatible phase/provider references.",
    "Compare IDs with `observability-gate catalog` and the active target."
  ],
  SECURITY_POLICY: [
    "A configured operation violates a security boundary.",
    "Workspace escape, unsafe URL, forbidden operation, or untrusted YAML feature.",
    "Keep files inside the workspace and endpoints on approved HTTPS hosts."
  ],
  AUTHENTICATION: [
    "A provider rejected the supplied identity.",
    "Expired or incorrect environment credential.",
    "Refresh the least-privilege credential at its source; never print it."
  ],
  AUTHORIZATION: [
    "The identity lacks a required read permission.",
    "Missing Kubernetes get/list/watch, Azure Reader, or Grafana read scope.",
    "Grant only the documented read permission and retry."
  ],
  PROVIDER_UNAVAILABLE: [
    "A required provider could not be reached.",
    "Timeout, reset, DNS, or exhausted transient retries.",
    "Verify endpoint reachability and provider health without weakening SSRF controls."
  ],
  PROVIDER_PROTOCOL: [
    "A provider returned an invalid protocol response.",
    "Malformed JSON, unexpected status, or incompatible response shape.",
    "Check provider compatibility and sanitized provider logs."
  ],
  EVIDENCE_INVALID: [
    "Evidence is absent, stale, insufficient, or malformed.",
    "No matching release signal, old timestamps, too few samples, or invalid files.",
    "Restore the evidence source or extend only the policy-approved observation window."
  ],
  CAPABILITY_UNSUPPORTED: [
    "The selected adapter cannot supply a gate requirement.",
    "Runtime/OS mismatch or missing adapter capability.",
    "Select an applicable gate or supported read-only adapter."
  ],
  GATE_EVALUATION: [
    "A gate exceeded its deadline or could not evaluate normalized evidence.",
    "Gate timeout or invalid assertion input.",
    "Inspect the named gate and evidence age; keep the phase deadline bounded."
  ],
  REPORTING: [
    "A required report could not be published.",
    "Filesystem, size limit, or GitHub permission failure.",
    "Restore write access to the output directory or configured GitHub permission."
  ],
  CANCELLED: [
    "Execution was cancelled.",
    "SIGINT, SIGTERM, workflow cancellation, or parent abort.",
    "Rerun when safe; cancelled partial results never count as pass."
  ],
  INTERNAL: [
    "An unexpected product error occurred.",
    "Unhandled invariant or adapter defect.",
    "Capture the stable code and sanitized context, then file an issue without secrets."
  ]
};

function troubleshootingDocument(): string {
  const rows = errorCodes.map((code) => {
    const entry = troubleshooting[code];
    if (entry === undefined) throw new Error(`Missing troubleshooting metadata for ${code}`);
    return `| ${code} | ${cell(entry[0])} | ${cell(entry[1])} | ${cell(entry[2])} |`;
  });
  return `# Troubleshooting

Diagnostics use stable error codes and safe messages. Standard output contains results; diagnostics
go to standard error. Raw queries, response bodies, logs, and credential values are never required
for routine diagnosis.

| Code | Meaning | Likely causes | Safe remediation |
| --- | --- | --- | --- |
${rows.join("\n")}
`;
}

export async function generateDocs(outputRoot: string): Promise<void> {
  await mkdir(join(outputRoot, "docs"), { recursive: true });
  await writeFile(
    join(outputRoot, "docs/observability-gate.schema.json"),
    await format(JSON.stringify(policyJsonSchema()), { parser: "json", printWidth: 100 }),
    "utf8"
  );
  const documents: Readonly<Record<string, string>> = {
    "docs/configuration.md": configurationDocument(),
    "docs/gates.md": gateDocument(),
    "docs/providers.md": providerDocument(),
    "docs/troubleshooting.md": troubleshootingDocument()
  };
  for (const [path, content] of Object.entries(documents)) {
    const output = join(outputRoot, path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      await format(content, { parser: "markdown", proseWrap: "always" }),
      "utf8"
    );
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  await generateDocs(process.argv[2] ?? process.cwd());
}
