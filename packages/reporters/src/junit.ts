import type { ExecutionResult, GateResult } from "@observability-gate/core";
import { collectChunks } from "./chunks.js";

function escapeXml(value: string): string {
  return [...value].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
  }).join("")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
}

function message(gate: GateResult): string {
  return (
    gate.assertions.find((assertion) => assertion.status !== "passed")?.message ??
    gate.diagnostics[0]?.message ??
    `Gate ended with status ${gate.status}.`
  );
}

function isFailure(gate: GateResult): boolean {
  return (
    gate.enforcement === "blocking" &&
    (gate.status === "failed" || gate.status === "inconclusive" || gate.status === "error")
  );
}

function isSkipped(gate: GateResult): boolean {
  return gate.status === "skipped" || (gate.enforcement === "advisory" && gate.status !== "passed");
}

export function* junitReportChunks(result: ExecutionResult): Iterable<string> {
  const runFailure = ["fail", "error", "inconclusive"].includes(result.decision) && (result.diagnostics.length > 0 || !result.gates.some(isFailure));
  const failures = result.gates.filter(isFailure).length + (runFailure ? 1 : 0);
  const skipped = result.gates.filter(isSkipped).length;
  yield `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Observability Gate" tests="${result.gates.length + (runFailure ? 1 : 0)}" failures="${failures}" skipped="${skipped}" time="${(Date.parse(result.completedAt) - Date.parse(result.startedAt)) / 1_000}">`
  ].join("\n")}\n`;
  if (runFailure) {
    const diagnostic = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("; ") || `Run ended with decision ${result.decision}.`;
    yield `  <testcase classname="observegate.execution" name="execution"><failure message="${escapeXml(diagnostic)}">${escapeXml(result.decision)}</failure></testcase>\n`;
  }
  for (const gate of result.gates) {
    yield `  <testcase classname="${escapeXml(gate.type)}" name="${escapeXml(gate.id)}" time="${gate.durationMs / 1_000}">\n`;
    if (isFailure(gate)) {
      yield `    <failure message="${escapeXml(message(gate))}">${escapeXml(gate.status)}</failure>\n`;
    } else if (isSkipped(gate)) {
      yield `    <skipped message="${escapeXml(message(gate))}"/>\n`;
    }
    yield "  </testcase>\n";
  }
  yield "</testsuite>\n";
}

export function renderJunit(result: ExecutionResult): string {
  return collectChunks(junitReportChunks(result));
}
