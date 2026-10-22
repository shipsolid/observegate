import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";
import { renderJson, renderJunit, renderMarkdown, renderSarif } from "../src/index.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Required report fixture value is missing.");
  return value;
}

async function fixture(): Promise<ExecutionResult> {
  return JSON.parse(
    await readFile(resolve("fixtures/reports/execution-result.json"), "utf8")
  ) as ExecutionResult;
}

describe("report projections", () => {
  it("preserves declared artifact retention for the workflow uploader", async () => {
    const rendered = JSON.parse(renderJson({ ...(await fixture()), artifactRetentionDays: 14 }));
    expect(rendered.artifactRetentionDays).toBe(14);
  });
  it("retains evidence validity and capability in canonical JSON", async () => {
    const base = await fixture(),
      gate = required(base.gates[0]),
      reference = required(gate.evidence[0]);
    const result = {
      ...base,
      gates: [
        {
          ...gate,
          evidence: [
            {
              ...reference,
              state: "valid" as const,
              capability: "metrics.query.instant",
              target: base.target.id,
              releaseId: base.release.candidateId
            }
          ]
        }
      ]
    };
    expect(JSON.parse(renderJson(result)).gates[0].evidence[0]).toMatchObject({
      state: "valid",
      capability: "metrics.query.instant",
      target: base.target.id,
      releaseId: base.release.candidateId
    });
  });
  it("represents a zero-gate execution failure in every projection", async () => {
    const failed: ExecutionResult = {
      ...(await fixture()),
      decision: "error",
      gates: [],
      diagnostics: [{ code: "AUTHENTICATION", message: "Credentials rejected", retryable: false }]
    };
    expect(renderMarkdown(failed)).toContain("Credentials rejected");
    expect(renderJunit(failed)).toContain('failures="1"');
    expect(renderJunit(failed)).toContain("Credentials rejected");
    const sarif = JSON.parse(renderSarif(failed));
    expect(sarif.runs[0].invocations[0].executionSuccessful).toBe(false);
    expect(sarif.runs[0].results[0].message.text).toContain("Credentials rejected");
  });

  it("removes XML-forbidden characters and retains valid Unicode", async () => {
    const base = await fixture();
    const gate = required(base.gates[0]);
    const value = {
      ...base,
      gates: [
        {
          ...gate,
          id: "test\u0001\ud800😀",
          assertions: [],
          diagnostics: [{ code: "TEST", message: "bad\u0000 & <value>", retryable: false }]
        }
      ]
    };
    const junit = renderJunit(value);
    expect(junit).not.toContain("\u0001");
    expect(junit).not.toContain("\ud800");
    expect(junit).not.toContain("\u0000");
    expect(junit).toContain("😀");
    expect(junit).toContain("&amp; &lt;value&gt;");
  });
  it("renders stable canonical JSON without raw responses or secrets", async () => {
    const rendered = renderJson(await fixture());
    expect(rendered).toBe(await readFile(resolve("fixtures/reports/golden/report.json"), "utf8"));
    expect(rendered).toContain('"configurationFingerprint": "sha256:policy"');
    expect(rendered).not.toMatch(/rawResponse|authorization|secret-token/iu);
  });

  it("renders an evidence-rich Markdown summary", async () => {
    const rendered = renderMarkdown(await fixture());
    expect(rendered).toBe(await readFile(resolve("fixtures/reports/golden/report.md"), "utf8"));
    expect(rendered.indexOf("release.error-rate")).toBeLessThan(rendered.indexOf("policy.sarif"));
    expect(rendered).toContain("0.04 ratio");
    expect(rendered).toContain("500 samples");
    expect(rendered).toContain("5s old");
  });

  it("maps blocking failures and advisory warnings to JUnit", async () => {
    const rendered = renderJunit(await fixture());
    expect(rendered).toBe(await readFile(resolve("fixtures/reports/golden/report.xml"), "utf8"));
    expect(rendered).toContain('<failure message="Error rate exceeded">');
    expect(rendered).toContain('<skipped message="Unsafe instrumentation setting"/>');
  });

  it("includes only findings with stable artifact locations in SARIF", async () => {
    const rendered = renderSarif(await fixture());
    expect(rendered).toBe(await readFile(resolve("fixtures/reports/golden/report.sarif"), "utf8"));
    const parsed = JSON.parse(rendered) as { runs: Array<{ results: unknown[] }> };
    expect(parsed.runs[0]?.results).toHaveLength(1);
    expect(rendered).toContain("src/telemetry.ts");
    expect(rendered).not.toContain("release.error-rate");
  });
});
