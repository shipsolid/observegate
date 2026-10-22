import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { finalizeCycloneDx } from "./finalize-sbom.ts";

const exec = promisify(execFile);
async function fileTree(directory: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      files.push(...(await fileTree(join(directory, entry.name), `${name}/`)));
    else files.push(name);
  }
  return files;
}

export async function compareBuildArtifacts(first: string, second: string): Promise<number> {
  const firstFiles = await fileTree(join(first, "dist/cli"), "dist/cli/");
  const secondFiles = await fileTree(join(second, "dist/cli"), "dist/cli/");
  if (JSON.stringify(firstFiles) !== JSON.stringify(secondFiles))
    throw new Error("Independent builds contain different CLI files");
  const names = [
    "dist/index.js",
    "dist/index.js.map",
    ...firstFiles,
    "cli.tar.gz",
    "sbom.cdx.json"
  ];
  for (const name of names) {
    if (!(await readFile(join(first, name))).equals(await readFile(join(second, name))))
      throw new Error(`Independent builds differ: ${name}`);
  }
  return names.length;
}

export async function smokeCliArchive(archive: string, fixtureRoot: string): Promise<void> {
  const smoke = await mkdtemp(join(tmpdir(), "observegate-standalone-"));
  try {
    const smokeOptions = {
      cwd: smoke,
      encoding: "utf8" as const,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024
    };
    await exec("tar", ["-xzf", archive, "-C", smoke], smokeOptions);
    await mkdir(join(smoke, "examples/evidence"), { recursive: true });
    await cp(
      join(fixtureRoot, "examples/evidence/synthetic.json"),
      join(smoke, "examples/evidence/synthetic.json")
    );
    const policy = await readFile(join(fixtureRoot, "examples/offline.yml"), "utf8");
    await writeFile(join(smoke, "policy.yml"), policy);
    for (const args of [
      ["validate", "--config", "policy.yml"],
      ["plan", "--config", "policy.yml", "--phase", "pre_deployment"],
      ["catalog", "--json"],
      ["explain", "runtime.release_identity", "--json"]
    ])
      await exec(process.execPath, ["observegate.js", ...args], smokeOptions);
    const run = [
      "observegate.js",
      "run",
      "--config",
      "policy.yml",
      "--phase",
      "post_deployment",
      "--json"
    ];
    const passed = await exec(process.execPath, run, smokeOptions);
    if (passed.stdout.trim().length === 0)
      throw new Error(
        `Standalone CLI produced no success result. stderr: ${passed.stderr.slice(0, 2000)}`
      );
    if (JSON.parse(passed.stdout).decision !== "pass")
      throw new Error("Standalone CLI did not pass the offline policy");
    await writeFile(
      join(smoke, "policy.yml"),
      policy.replaceAll("demo-release-v1", "demo-release-v2")
    );
    let failedAsExpected = false;
    try {
      await exec(process.execPath, run, smokeOptions);
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 1 &&
        "stdout" in error &&
        typeof error.stdout === "string"
      ) {
        if (error.stdout.trim().length === 0)
          throw new Error(
            `Standalone CLI exited 1 without a failure result. stderr: ${"stderr" in error && typeof error.stderr === "string" ? error.stderr.slice(0, 2000) : "unavailable"}`,
            { cause: error }
          );
        failedAsExpected = JSON.parse(error.stdout).decision === "fail";
      } else throw error;
    }
    if (!failedAsExpected)
      throw new Error("Standalone CLI did not reject mismatched release evidence");
  } finally {
    await rm(smoke, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const temporary = await mkdtemp(join(tmpdir(), "observegate-reproducibility-"));
  let succeeded = false;
  const excluded = new Set([
    "dist",
    "lib",
    "node_modules",
    "coverage",
    ".git",
    ".superpowers",
    ".agents",
    ".aws",
    ".codex"
  ]);

  async function build(name: string): Promise<string> {
    const directory = join(temporary, name);
    for (const source of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.base.json",
      "rollup.config.js",
      "README.md",
      "LICENSE",
      "packages"
    ]) {
      await cp(resolve(root, source), join(directory, source), {
        recursive: true,
        filter: (path) => !excluded.has(basename(path)) && !path.endsWith(".tsbuildinfo")
      });
    }
    const environment = {
      ...process.env,
      TZ: "UTC",
      SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? "0"
    };
    const options = {
      cwd: directory,
      env: environment,
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
      encoding: "utf8" as const
    };
    const install = ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
    if (process.argv.includes("--offline")) install.push("--offline");
    await exec("npm", install, options);
    await exec("npm", ["run", "bundle"], options);
    const artifact = join(directory, "cli.tar.gz");
    await exec(
      "tar",
      [
        "--sort=name",
        `--mtime=@${environment.SOURCE_DATE_EPOCH}`,
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "--create",
        "--gzip",
        `--file=${artifact}`,
        "--directory=dist/cli",
        "."
      ],
      options
    );
    const manifest = JSON.parse(await readFile(join(directory, "dist/cli/package.json"), "utf8"));
    const sourceMap = JSON.parse(
      await readFile(join(directory, "dist/cli/observegate.js.map"), "utf8")
    );
    const lock = JSON.parse(await readFile(join(directory, "package-lock.json"), "utf8"));
    const sbom = finalizeCycloneDx(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        metadata: { component: { name: manifest.name, version: manifest.version } }
      },
      sourceMap,
      lock,
      environment.SOURCE_DATE_EPOCH
    );
    await writeFile(join(directory, "sbom.cdx.json"), JSON.stringify(sbom));
    return directory;
  }

  try {
    const first = await build("first");
    const second = await build("second");
    const count = await compareBuildArtifacts(first, second);
    await smokeCliArchive(join(first, "cli.tar.gz"), root);
    process.stdout.write(
      `verify:reproducible: two independent locked installs/builds match (${count} artifacts, including CLI archive and SBOM metadata); standalone CLI discovery and pass/fail smoke passed without node_modules\n`
    );
    succeeded = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Build comparison failed.";
    process.stderr.write(`verify:reproducible: ${message}\n`);
    if (error !== null && typeof error === "object") {
      for (const stream of ["stdout", "stderr"] as const) {
        if (stream in error && typeof error[stream] === "string")
          process.stderr.write(error[stream]);
      }
    }
    process.exitCode = 1;
  } finally {
    if (!succeeded && process.argv.includes("--keep-on-failure"))
      process.stderr.write(`Build workspace: ${temporary}\n`);
    else await rm(temporary, { recursive: true, force: true });
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) await main();
