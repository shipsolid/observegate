import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));
const plugins = () => [
  {
    name: "deny-sdk-subprocesses",
    resolveId(id) {
      if (id === "child_process" || id === "node:child_process")
        return "\0observegate-denied-subprocess";
      if (id.startsWith("node:")) return { id, external: true };
    },
    load(id) {
      if (id !== "\0observegate-denied-subprocess") return;
      return `const denied = () => { throw new Error("ObserveGate forbids external commands; use workload identity or non-executable credentials."); };
        export const spawn = denied, spawnSync = denied, exec = denied, execSync = denied, execFile = denied, execFileSync = denied, fork = denied, ChildProcess = denied;
        export default { spawn, spawnSync, exec, execSync, execFile, execFileSync, fork, ChildProcess };`;
    },
    transform(code, id) {
      // Keep ws's built-in JavaScript/Node UTF-8 paths; optional native addons cannot ship in one portable archive.
      if (/\/ws\/lib\/(?:buffer-util|validation)\.js$/u.test(id)) {
        return {
          code: code
            .replaceAll("process.env.WS_NO_BUFFER_UTIL", '"1"')
            .replaceAll("process.env.WS_NO_UTF_8_VALIDATE", '"1"'),
          map: null
        };
      }
    }
  },
  nodeResolve({ preferBuiltins: true }),
  json(),
  commonjs()
];

export default [
  {
    input: "packages/action/lib/main.js",
    output: { file: "dist/index.js", format: "es", sourcemap: true, inlineDynamicImports: true },
    plugins: plugins()
  },
  {
    input: "packages/cli/dist/main.js",
    output: {
      file: "dist/cli/observegate.js",
      format: "es",
      inlineDynamicImports: true,
      sourcemap: true
    },
    plugins: [
      ...plugins(),
      {
        name: "observegate-cli-package",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "package.json",
            source: `${JSON.stringify(
              {
                name: "@shipsolid/observegate",
                version: manifest.version,
                description: "Read-only observability deployment gate CLI",
                type: "module",
                bin: { observegate: "./observegate.js" },
                engines: { node: ">=24" },
                license: "Apache-2.0"
              },
              null,
              2
            )}\n`
          });
          this.emitFile({
            type: "asset",
            fileName: "README.md",
            source: readFileSync(new URL("README.md", import.meta.url), "utf8")
          });
          this.emitFile({
            type: "asset",
            fileName: "LICENSE",
            source: readFileSync(new URL("LICENSE", import.meta.url), "utf8")
          });
        }
      }
    ]
  }
];
