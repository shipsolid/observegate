import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
