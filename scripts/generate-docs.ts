import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { format } from "prettier";
import { configurationFields } from "../packages/config/dist/index.js";
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
