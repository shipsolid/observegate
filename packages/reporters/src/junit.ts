import type { ExecutionResult, GateResult } from "@observability-gate/core";

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

export function renderJunit(result: ExecutionResult): string {
  const failures = result.gates.filter(isFailure).length;
  const skipped = result.gates.filter(isSkipped).length;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Observability Gate" tests="${result.gates.length}" failures="${failures}" skipped="${skipped}" time="${(Date.parse(result.completedAt) - Date.parse(result.startedAt)) / 1_000}">`
  ];
  for (const gate of result.gates) {
    lines.push(
      `  <testcase classname="${escapeXml(gate.type)}" name="${escapeXml(gate.id)}" time="${gate.durationMs / 1_000}">`
    );
    if (isFailure(gate)) {
      lines.push(
        `    <failure message="${escapeXml(message(gate))}">${escapeXml(gate.status)}</failure>`
      );
    } else if (isSkipped(gate)) {
      lines.push(`    <skipped message="${escapeXml(message(gate))}"/>`);
    }
    lines.push("  </testcase>");
  }
  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}
