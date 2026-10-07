import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { inspectBundleImports } from "./bundle-policy.ts";
import { inspectReadOnlyFiles } from "./read-only-policy.ts";

async function files(path: string): Promise<readonly string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const child = join(path, entry.name);
        return entry.isDirectory()
          ? files(child)
          : Promise.resolve(child.endsWith(".ts") ? [child] : []);
      })
    )
  ).flat();
}

const root = process.cwd();
const packages = await readdir(join(root, "packages"), { withFileTypes: true });
const productionFiles = (
  await Promise.all(
    packages
      .filter((entry) => entry.isDirectory())
      .map((entry) => files(join(root, "packages", entry.name, "src")))
  )
).flat();
const violations = [...inspectReadOnlyFiles(root, productionFiles)];

for (const bundle of ["dist/index.js", "dist/cli/observegate.js"]) {
  violations.push(...inspectBundleImports(bundle, await readFile(join(root, bundle), "utf8")));
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `verify:read-only: scanned ${productionFiles.length} production files and both bundles; no mutation or remote-shell APIs found\n`
);
