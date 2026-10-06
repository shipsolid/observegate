import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionResult } from "@observability-gate/core";
import { renderJson, renderJunit, renderMarkdown, renderSarif } from "../src/index.js";

async function fixture(): Promise<ExecutionResult> {
  return JSON.parse(
    await readFile(resolve("fixtures/reports/execution-result.json"), "utf8")
  ) as ExecutionResult;
}

describe("report projections", () => {
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
