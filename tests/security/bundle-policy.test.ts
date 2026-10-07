import { describe, expect, it } from "vitest";
import { inspectBundleImports, inspectSourceMap } from "../../scripts/bundle-policy.js";

describe("production bundle policy", () => {
  it("allows Node built-ins and rejects shell-capable or unbundled modules", () => {
    expect(
      inspectBundleImports("bundle.js", "import { readFile } from 'node:fs/promises';")
    ).toHaveLength(0);
    expect(
      inspectBundleImports("bundle.js", "import { spawn } from 'node:child_process';")
    ).toEqual(["bundle.js imports prohibited module node:child_process"]);
    expect(inspectBundleImports("bundle.js", "import 'left-pad';")).toEqual([
      "bundle.js retains external module import left-pad"
    ]);
    expect(inspectBundleImports("bundle.js", "require('@actions/core');")).toEqual([
      "bundle.js retains external module import @actions/core"
    ]);
  });

  it("rejects POSIX, Windows, and file URL paths in source maps", () => {
    const violations = inspectSourceMap(
      "bundle.js.map",
      JSON.stringify({
        version: 3,
        sourceRoot: "file:///workspace/",
        sources: ["/home/amit/source.ts", "C:\\workspace\\source.ts", "../source.ts"]
      })
    );
    expect(violations).toEqual([
      "bundle.js.map contains absolute sourceRoot file:///workspace/",
      "bundle.js.map contains absolute source path /home/amit/source.ts",
      "bundle.js.map contains absolute source path C:\\workspace\\source.ts"
    ]);
  });
});
