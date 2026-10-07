import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

async function sourceFiles(path: string): Promise<readonly string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const child = join(path, entry.name);
      return entry.isDirectory()
        ? sourceFiles(child)
        : Promise.resolve(child.endsWith(".ts") ? [child] : []);
    })
  );
  return nested.flat();
}

describe("read-only implementation boundary", () => {
  it("contains no shell, remote-host, or runtime mutation APIs in production source", async () => {
    const packages = await readdir(join(process.cwd(), "packages"), { withFileTypes: true });
    const files = (
      await Promise.all(
        packages
          .filter((entry) => entry.isDirectory())
          .map((entry) => sourceFiles(join(process.cwd(), "packages", entry.name, "src")))
      )
    ).flat();
    const prohibited = [
      /from\s+["']node:child_process["']/u,
      /from\s+["'](?:ssh2|node-ssh|winrm)["']/iu,
      /\b(?:create|replace|patch|delete)(?:Namespaced)?(?:Deployment|StatefulSet|DaemonSet|Pod)\s*\(/u,
      /\b(?:beginCreateOrUpdate|beginDelete|updateTraffic|restart)\s*\(/u
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (prohibited.some((pattern) => pattern.test(source))) violations.push(file);
    }

    expect(violations).toEqual([]);
  });
});
