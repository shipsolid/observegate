import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "observegate-reproducibility-"));
const excluded = new Set(["dist", "lib", "node_modules", "coverage", ".git", ".superpowers", ".agents", ".aws", ".codex"]);

async function fileTree(directory: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await fileTree(join(directory, entry.name), `${name}/`));
    else files.push(name);
  }
  return files;
}

async function build(name: string): Promise<string> {
  const directory = join(temporary, name);
  for (const source of ["package.json", "package-lock.json", "tsconfig.json", "tsconfig.base.json", "rollup.config.js", "README.md", "LICENSE", "packages"]) {
    await cp(resolve(root, source), join(directory, source), { recursive: true, filter: (path) => !excluded.has(basename(path)) && !path.endsWith(".tsbuildinfo") });
  }
  const environment = { ...process.env, TZ: "UTC", SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "0" };
  const options = { cwd: directory, env: environment, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 };
  const install = ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
  if (process.argv.includes("--offline")) install.push("--offline");
  await exec("npm", install, options);
  await exec("npm", ["run", "bundle"], options);
  const artifact = join(directory, "cli.tar.gz");
  await exec("tar", ["--sort=name", `--mtime=@${environment.SOURCE_DATE_EPOCH}`, "--owner=0", "--group=0", "--numeric-owner", "--create", "--gzip", `--file=${artifact}`, "--directory=dist/cli", "."], options);
  return directory;
}

try {
  const first = await build("first");
  const second = await build("second");
  const names = ["dist/index.js", "dist/index.js.map", ...await fileTree(join(first, "dist/cli"), "dist/cli/"), "cli.tar.gz"];
  for (const name of names) {
    if (!(await readFile(join(first, name))).equals(await readFile(join(second, name)))) throw new Error(`Independent builds differ: ${name}`);
  }
  process.stdout.write(`verify:reproducible: two independent locked installs/builds match (${names.length} artifacts, including CLI archive)\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Build comparison failed.";
  process.stderr.write(`verify:reproducible: ${message}\n`);
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
