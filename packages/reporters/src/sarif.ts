import type { Diagnostic, ExecutionResult } from "@observability-gate/core";

interface LocatedDiagnostic {
  readonly gateId: string;
  readonly level: "error" | "warning";
  readonly diagnostic: Diagnostic & {
    readonly artifactLocation: NonNullable<Diagnostic["artifactLocation"]>;
  };
}

export function renderSarif(result: ExecutionResult): string {
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
  const sarif = {
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
  return `${JSON.stringify(sarif, null, 2)}\n`;
}
