import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { URL, fileURLToPath } from "node:url";

export default {
  input: fileURLToPath(new URL("lib/main.js", import.meta.url)),
  output: {
    file: fileURLToPath(new URL("../../dist/index.js", import.meta.url)),
    format: "es",
    sourcemap: true
  },
  plugins: [nodeResolve({ preferBuiltins: true }), commonjs()]
};
