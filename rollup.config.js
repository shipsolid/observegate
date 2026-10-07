import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const manifest = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));
const plugins = () => [nodeResolve({ preferBuiltins: true }), commonjs()];

export default [
  {
    input: "packages/action/lib/main.js",
    output: { file: "dist/index.js", format: "es", sourcemap: true },
    plugins: plugins()
  },
  {
    input: "packages/cli/dist/main.js",
    output: {
      file: "dist/cli/observegate.js",
      format: "es",
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
