import { builtinModules } from "node:module";
import { posix, win32 } from "node:path";
import ts from "typescript";

const builtins = new Set(
  builtinModules.flatMap((name) => [name, name.startsWith("node:") ? name : `node:${name}`])
);
const prohibitedBuiltins = new Set(["child_process", "node:child_process"]);

function moduleViolation(file: string, moduleName: string): string | undefined {
  if (prohibitedBuiltins.has(moduleName)) {
    return `${file} imports prohibited module ${moduleName}`;
  }
  if (!builtins.has(moduleName)) return `${file} retains external module import ${moduleName}`;
  return undefined;
}

export function inspectBundleImports(file: string, source: string): readonly string[] {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const violations: string[] = [];
  const inspect = (node: ts.Node): void => {
    let moduleName: string | undefined;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleName = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      moduleName = node.arguments[0].text;
    }
    if (moduleName !== undefined) {
      const violation = moduleViolation(file, moduleName);
      if (violation !== undefined) violations.push(violation);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(parsed);
  return violations;
}

function absolutePath(value: string): boolean {
  return posix.isAbsolute(value) || win32.isAbsolute(value) || value.startsWith("file:");
}

export function inspectSourceMap(file: string, source: string): readonly string[] {
  let map: { readonly sourceRoot?: unknown; readonly sources?: unknown };
  try {
    map = JSON.parse(source) as typeof map;
  } catch {
    return [`${file} is not valid JSON`];
  }
  const violations: string[] = [];
  if (typeof map.sourceRoot === "string" && absolutePath(map.sourceRoot)) {
    violations.push(`${file} contains absolute sourceRoot ${map.sourceRoot}`);
  }
  if (!Array.isArray(map.sources)) return [...violations, `${file} has no sources array`];
  for (const entry of map.sources) {
    if (typeof entry === "string" && absolutePath(entry)) {
      violations.push(`${file} contains absolute source path ${entry}`);
    }
  }
  return violations;
}
