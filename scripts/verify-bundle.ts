import { access, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

function fail(message: string): never {
  process.stderr.write(`verify:bundle: ${message}\n`);
  process.exit(1);
}

const root = process.cwd();
const action = parse(await readFile(resolve(root, "action.yml"), "utf8")) as {
  runs?: { using?: unknown; main?: unknown };
};
if (action.runs?.using !== "node24") fail("action.yml must select node24");
if (action.runs.main !== "dist/index.js") fail("action.yml must point to dist/index.js");

const files = [
  "dist/index.js",
  "dist/index.js.map",
  "dist/cli/observegate.js",
  "dist/cli/observegate.js.map",
  "dist/cli/package.json",
  "dist/cli/README.md",
  "dist/cli/LICENSE"
];
for (const file of files) await access(resolve(root, file));

const bundle = await readFile(resolve(root, "dist/index.js"), "utf8");
const cli = await readFile(resolve(root, "dist/cli/observegate.js"), "utf8");
for (const [name, source] of [
  ["Action", bundle],
  ["CLI", cli]
] as const) {
  if (/from\s+["'](?:@actions|@observability-gate)\//u.test(source)) {
    fail(`${name} bundle retains a production package import`);
  }
}
for (const file of files.filter((path) => path.endsWith(".js") || path.endsWith(".js.map"))) {
  const source = await readFile(resolve(root, file), "utf8");
  if (/\/(?:home|Users)\/[^/]+\//u.test(source)) {
    fail(`${file} contains an absolute development path`);
  }
}
if (!cli.startsWith("#!/usr/bin/env node")) fail("CLI bundle is missing its executable shebang");
if ((await stat(resolve(root, "dist/index.js"))).size === 0) fail("Action bundle is empty");
if ((await stat(resolve(root, "dist/cli/observegate.js"))).size === 0) fail("CLI bundle is empty");

process.stdout.write("verify:bundle: Action and CLI bundles are complete and relocatable\n");
