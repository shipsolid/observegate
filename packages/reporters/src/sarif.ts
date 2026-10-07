import type { Diagnostic, ExecutionResult } from "@observability-gate/core";
import { collectChunks, jsonChunks } from "./chunks.js";

interface LocatedDiagnostic {
  readonly gateId: string;
  readonly level: "error" | "warning";
  readonly diagnostic: Diagnostic & {
    readonly artifactLocation: NonNullable<Diagnostic["artifactLocation"]>;
  };
}

function sarifReportDto(result: ExecutionResult): Readonly<Record<string, unknown>> {
  const findings: LocatedDiagnostic[] = result.gates.flatMap((gate) =>
    gate.diagnostics
      .filter(
        (
          item
        ): item is Diagnostic & {
          readonly artifactLocation: NonNullable<Diagnostic["artifactLocation"]>;
        } => item.artifactLocation !== undefined
      )
      .map((item) => ({
        gateId: gate.id,
        level: gate.enforcement === "blocking" ? ("error" as const) : ("warning" as const),
        diagnostic: item
      }))
  );
  const rules = [...new Set(findings.map((finding) => finding.gateId))].map((id) => ({ id }));
  return {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "Observability Gate", rules } },
        results: findings.map(({ gateId, level, diagnostic }) => ({
          ruleId: gateId,
          level,
          message: { text: diagnostic.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: diagnostic.artifactLocation.uri },
                region: {
                  ...(diagnostic.artifactLocation.line === undefined
                    ? {}
                    : { startLine: diagnostic.artifactLocation.line }),
                  ...(diagnostic.artifactLocation.column === undefined
                    ? {}
                    : { startColumn: diagnostic.artifactLocation.column })
                }
              }
            }
          ]
        }))
      }
    ]
  };
}

export function* sarifReportChunks(result: ExecutionResult): Iterable<string> {
  yield* jsonChunks(sarifReportDto(result));
  yield "\n";
}

export function renderSarif(result: ExecutionResult): string {
  return collectChunks(sarifReportChunks(result));
}
