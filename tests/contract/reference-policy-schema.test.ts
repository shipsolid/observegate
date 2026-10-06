import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePolicy, parseYaml } from "@observability-gate/config";

const referencePath = join(process.cwd(), "examples", "observability-gate.yml");

describe("reference policy schema contract", () => {
  it("has no synthetic schema version and remains parseable", async () => {
    const text = await readFile(referencePath, "utf8");
    const raw = parseYaml(text) as Readonly<Record<string, unknown>>;
    expect(raw).not.toHaveProperty("version");
    expect(raw).not.toHaveProperty("schema_version");
    expect(parsePolicy(text).gates.post_deployment).toHaveLength(47);
  });

  it("contains no prohibited runtime or shell operation in production source", async () => {
    async function sourceFiles(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      return (
        await Promise.all(
          entries.map((entry) =>
            entry.isDirectory()
              ? sourceFiles(join(directory, entry.name))
              : [join(directory, entry.name)]
          )
        )
      ).flat();
    }
    const files = (await sourceFiles(join(process.cwd(), "packages"))).filter(
      (path) => path.includes("/src/") && path.endsWith(".ts")
    );
    const prohibited =
      /(?:from\s+["']node:child_process["']|(?<!\.)\b(?:exec|spawn|ssh|winrm)\s*\(|\b(?:kubectl|az)\s+)/u;
    for (const file of files) expect(await readFile(file, "utf8"), file).not.toMatch(prohibited);
  });
});
