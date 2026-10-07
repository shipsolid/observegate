import type { ExecutionResult, GateResult } from "@observability-gate/core";
import { collectChunks } from "./chunks.js";

function escapeXml(value: string): string {
  return value
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
  const failures = result.gates.filter(isFailure).length;
  const skipped = result.gates.filter(isSkipped).length;
  yield `${[
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Observability Gate" tests="${result.gates.length}" failures="${failures}" skipped="${skipped}" time="${(Date.parse(result.completedAt) - Date.parse(result.startedAt)) / 1_000}">`
  ].join("\n")}\n`;
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
