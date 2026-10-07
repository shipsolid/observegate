import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";

const bannedModules = new Set([
  "node:child_process",
  "child_process",
  "ssh2",
  "node-ssh",
  "winrm",
  "@kubernetes/client-node/dist/gen/model/v1DeleteOptions"
]);
const bannedCalls = [
  /^(?:create|replace|patch|delete|deleteCollection)(?:Namespaced)?(?:Deployment|StatefulSet|DaemonSet|Pod|Service)(?:Scale|Status)?$/u,
  /^(?:beginCreateOrUpdate|createOrUpdate|beginDelete|deleteById)(?:AndWait)?$/iu,
  /^(?:begin)?(?:updateTraffic|setTraffic|shiftTraffic|restart|scale)(?:AndWait)?$/iu
];

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
const violations: string[] = [];

for (const path of productionFiles) {
  const source = await readFile(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const inspect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      bannedModules.has(node.moduleSpecifier.text)
    ) {
      violations.push(`${relative(root, path)} imports ${node.moduleSpecifier.text}`);
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        violations.push(`${relative(root, path)} uses dynamic import`);
      }
      const name = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : undefined;
      if (name !== undefined && bannedCalls.some((pattern) => pattern.test(name))) {
        violations.push(`${relative(root, path)} calls prohibited method ${name}`);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(file);
}

if (violations.length > 0) {
  process.stderr.write(`${violations.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `verify:read-only: scanned ${productionFiles.length} production files; no mutation or remote-shell APIs found\n`
);
