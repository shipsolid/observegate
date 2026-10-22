import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { generateDocs } from "../../scripts/generate-docs.js";

const generated = [
  "configuration.md",
  "gates.md",
  "providers.md",
  "troubleshooting.md",
  "observability-gate.schema.json"
];

describe("generated documentation", () => {
  it("matches source metadata", async () => {
    const output = await mkdtemp(join(tmpdir(), "observegate-docs-"));
    await generateDocs(output);
    for (const name of generated) {
      expect(await readFile(join(output, "docs", name), "utf8")).toBe(
        await readFile(resolve("docs", name), "utf8")
      );
    }
  });

  it("keeps the approved reference policy byte-stable", async () => {
    const content = await readFile(resolve("examples/observability-gate.yml"));
    expect(createHash("sha256").update(content).digest("hex")).toBe(
      "a3be9ee9767873cca63a1e73ae4552f501fe6a0de6c486c9a2099095be813b5e"
    );
  });

  it("pins every external workflow action to a full commit SHA", async () => {
    const workflow = await readFile(resolve("examples/workflows/pre-and-post.yml"), "utf8");
    const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)/gmu)].map(
      (match) => match[1] ?? ""
    );
    expect(references.length).toBeGreaterThan(0);
    expect(
      references.every((reference) => reference === "./" || /@[0-9a-f]{40}$/u.test(reference))
    ).toBe(true);
    expect(workflow).toContain("deployed_at: ${{ steps.release.outputs.deployed_at }}");
    expect(workflow).toContain("previous_release: ${{ steps.previous.outputs.release_id }}");
  });
});
