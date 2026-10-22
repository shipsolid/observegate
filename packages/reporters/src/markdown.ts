import type { AssertionResult, ExecutionResult, GateResult } from "@observability-gate/core";
import { collectChunks } from "./chunks.js";

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

function* lines(values: Iterable<string>): Iterable<string> {
  for (const value of values) {
    yield value;
    yield "\n";
  }
}

export interface MarkdownReportOptions {
  readonly sections?: readonly (
    | "decision"
    | "identity"
    | "target"
    | "evidence_coverage"
    | "blocking_gates"
    | "advisory_gates"
    | "skipped_gates"
    | "comparisons"
    | "links"
  )[];
}

export function* markdownReportChunks(
  result: ExecutionResult,
  options: MarkdownReportOptions = {}
): Iterable<string> {
  if (options.sections !== undefined) {
    yield* selectedMarkdownChunks(result, options.sections);
    return;
  }
  yield* lines([
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
    ...(result.diagnostics.length === 0
      ? []
      : [
          "## Execution diagnostics",
          "",
          ...result.diagnostics.map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`),
          ""
        ]),
    ...(result.providerTimings === undefined || result.providerTimings.length === 0
      ? []
      : [
          "## Provider acquisition timings",
          "",
          ...result.providerTimings.map(
            (timing) => `- ${timing.provider}: ${timing.durationMs} ms across ${timing.calls} calls`
          ),
          ""
        ]),
    "## Gates",
    ""
  ]);
  const ordered = result.gates
    .map((gate, index) => ({ gate, index }))
    .sort((left, right) => priority(left.gate) - priority(right.gate) || left.index - right.index);
  for (const { gate } of ordered) yield* lines(gateSection(gate));

  yield* lines(["## Links", ""]);
  const links = Object.entries(result.links).sort(([left], [right]) => left.localeCompare(right));
  if (links.length === 0) yield* lines(["No links configured."]);
  else {
    for (const [name, url] of links) {
      yield `- [${name}](`;
      yield url;
      yield ")\n";
    }
  }
}

export function renderMarkdown(
  result: ExecutionResult,
  options: MarkdownReportOptions = {}
): string {
  return collectChunks(markdownReportChunks(result, options));
}

function* selectedMarkdownChunks(
  result: ExecutionResult,
  sections: NonNullable<MarkdownReportOptions["sections"]>
): Iterable<string> {
  yield* lines(["# Observability Gate", ""]);
  for (const section of sections) {
    if (section === "decision")
      yield* lines([`**Decision:** ${result.decision}`, "", `- Phase: ${result.phase}`, ""]);
    else if (section === "identity")
      yield* lines([
        `- Release: ${result.release.candidateId}`,
        `- Deployment: ${result.release.deploymentId}`,
        ...(result.release.baselineId === undefined
          ? []
          : [`- Baseline release: ${result.release.baselineId}`]),
        ""
      ]);
    else if (section === "target")
      yield* lines([
        `- Target: ${result.target.id} (${result.target.runtimeType}, ${result.target.provider})`,
        ""
      ]);
    else if (section === "evidence_coverage")
      yield* lines([`- Evidence coverage: ${result.evidenceCoveragePercent}%`, ""]);
    else if (section === "links") {
      yield* lines(["## Links", ""]);
      for (const [name, url] of Object.entries(result.links).sort(([left], [right]) =>
        left.localeCompare(right)
      ))
        yield* lines([`- [${name.replaceAll("[", "\\[").replaceAll("]", "\\]")}](${url})`]);
      if (Object.keys(result.links).length === 0) yield* lines(["No links configured."]);
    } else {
      const selected = result.gates
        .filter((gate) => {
          if (gate.status === "skipped") return section === "skipped_gates";
          if (/compar(?:e|ison)/u.test(gate.type)) return section === "comparisons";
          return (
            section === (gate.enforcement === "blocking" ? "blocking_gates" : "advisory_gates")
          );
        })
        .map((gate, index) => ({ gate, index }))
        .sort(
          (left, right) => priority(left.gate) - priority(right.gate) || left.index - right.index
        );
      yield* lines([`## ${section.replaceAll("_", " ")}`, ""]);
      for (const { gate } of selected) yield* lines(gateSection(gate));
    }
  }
  if (result.diagnostics.length > 0)
    yield* lines([
      "## Execution diagnostics",
      "",
      ...result.diagnostics.map((diagnostic) => `- ${diagnostic.code}: ${diagnostic.message}`),
      ""
    ]);
}
