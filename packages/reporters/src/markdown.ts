import type { AssertionResult, ExecutionResult, GateResult } from "@observability-gate/core";

function display(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function priority(gate: GateResult): number {
  if (gate.enforcement === "blocking" && (gate.status === "failed" || gate.status === "error")) {
    return 0;
  }
  if (gate.enforcement === "blocking" && gate.status === "inconclusive") return 1;
  if (gate.enforcement === "advisory" && gate.status !== "passed" && gate.status !== "skipped") {
    return 2;
  }
  if (gate.status === "skipped") return 3;
  return 4;
}

function assertionLine(assertion: AssertionResult): string {
  const observed =
    assertion.observed === undefined
      ? "unavailable"
      : `${display(assertion.observed)}${assertion.unit === undefined ? "" : ` ${assertion.unit}`}`;
  const expected =
    assertion.expected === undefined
      ? "not specified"
      : `${display(assertion.expected)}${assertion.unit === undefined ? "" : ` ${assertion.unit}`}`;
  const details = [
    assertion.window === undefined ? undefined : `window ${assertion.window}`,
    assertion.sampleCount === undefined ? undefined : `${assertion.sampleCount} samples`
  ].filter((item): item is string => item !== undefined);
  return `- ${assertion.assertion}: observed ${observed}; expected ${expected}${details.length === 0 ? "" : `; ${details.join(", ")}`} — ${assertion.message}`;
}

function gateSection(gate: GateResult): string[] {
  const lines = [`### ${gate.id} — ${gate.status}`, ""];
  lines.push(`- Enforcement: ${gate.enforcement}`);
  for (const assertion of gate.assertions) lines.push(assertionLine(assertion));
  for (const evidence of gate.evidence) {
    const age = evidence.ageMs === undefined ? "age unavailable" : `${evidence.ageMs / 1_000}s old`;
    lines.push(`- Evidence: ${evidence.kind} from ${evidence.provider}, ${age}`);
  }
  for (const item of gate.diagnostics) lines.push(`- ${item.code}: ${item.message}`);
  if (gate.remediation !== undefined) lines.push(`- Remediation: ${gate.remediation}`);
  lines.push("");
  return lines;
}

export function renderMarkdown(result: ExecutionResult): string {
  const lines = [
    "# Observability Gate",
    "",
    `**Decision:** ${result.decision}`,
    "",
    `- Phase: ${result.phase}`,
    `- Target: ${result.target.id} (${result.target.runtimeType}, ${result.target.provider})`,
    `- Release: ${result.release.candidateId}`,
    ...(result.release.baselineId === undefined
      ? []
      : [`- Baseline release: ${result.release.baselineId}`]),
    `- Evidence coverage: ${result.evidenceCoveragePercent}%`,
    "",
    "## Gates",
    ""
  ];
  const ordered = result.gates
    .map((gate, index) => ({ gate, index }))
    .sort((left, right) => priority(left.gate) - priority(right.gate) || left.index - right.index);
  for (const { gate } of ordered) lines.push(...gateSection(gate));

  lines.push("## Links", "");
  const links = Object.entries(result.links).sort(([left], [right]) => left.localeCompare(right));
  if (links.length === 0) lines.push("No links configured.");
  else for (const [name, url] of links) lines.push(`- [${name}](${url})`);
  return `${lines.join("\n")}\n`;
}
