import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SourceMap } from "node:module";
import { rollup } from "rollup";
import { afterEach, describe, expect, it } from "vitest";
import bundleConfigurations from "../../rollup.config.js";
import { compareBuildArtifacts } from "../../scripts/verify-reproducible-build.js";

const directories: string[] = [];
async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "observegate-repro-test-"));
  directories.push(root);
  await mkdir(join(root, "dist/cli"), { recursive: true });
  for (const file of [
    "dist/index.js",
    "dist/index.js.map",
    "dist/cli/observegate.js",
    "cli.tar.gz",
    "sbom.cdx.json"
  ])
    await writeFile(join(root, file), "deterministic");
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("independent release build comparison", () => {
  it.each(bundleConfigurations)(
    "emits LF JavaScript with accurate source maps for $input",
    async (configuration) => {
      const root = await fixture();
      const input = join(root, "crlf.js");
      const source = "export function answer() {\r\n  return 42;\r\n}\r\n";
      await writeFile(input, source);
      const bundle = await rollup({ input, plugins: configuration.plugins });
      try {
        const { output } = await bundle.generate({
          ...configuration.output,
          file: join(root, "bundle.js")
        });
        const chunk = output.find((item) => item.type === "chunk");
        assert(chunk?.map, "Expected a JavaScript chunk with a source map");
        expect(chunk.code).not.toContain("\r");
        const module = await import(`data:text/javascript,${encodeURIComponent(chunk.code)}`);
        expect(module.answer()).toBe(42);
        expect(chunk.map?.sourcesContent).toContain(source);
        const generatedLine = chunk.code
          .split("\n")
          .findIndex((line) => line.includes("return 42"));
        const mapping = new SourceMap(chunk.map).findEntry(generatedLine, 2);
        expect(mapping.originalLine).toBe(1);
        expect(mapping.originalColumn).toBe(2);
      } finally {
        await bundle.close();
      }
    }
  );

  it("accepts matching artifacts from independent directories", async () => {
    expect(await compareBuildArtifacts(await fixture(), await fixture())).toBe(5);
  });
  it("rejects controlled nondeterministic output before publication", async () => {
    const first = await fixture(),
      second = await fixture();
    await writeFile(join(second, "dist/cli/observegate.js"), "build-time-randomness");
    await expect(compareBuildArtifacts(first, second)).rejects.toThrow(
      "Independent builds differ: dist/cli/observegate.js"
    );
  });
  it("rejects unexpected files in the second build", async () => {
    const first = await fixture(),
      second = await fixture();
    await writeFile(join(second, "dist/cli/unexpected.js"), "extra");
    await expect(compareBuildArtifacts(first, second)).rejects.toThrow("different CLI files");
  });
});
