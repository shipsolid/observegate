import { join, relative } from "node:path";
import ts from "typescript";

const bannedModules = new Set(["node:child_process", "child_process", "ssh2", "node-ssh", "winrm"]);
const kubernetesMutation =
  /^(?:create|replace|patch|delete|deleteCollection)(?:Namespaced|Cluster)[A-Z].+$/u;
const azureMutation =
  /^(?:begin(?:CreateOrUpdate|Update|Delete|Restart|Start|Stop|Deallocate|Redeploy|Reapply|PerformMaintenance|PowerOff)(?:AndWait)?|createOrUpdate(?:AndWait)?|deleteById(?:AndWait)?|updateTraffic(?:AndWait)?|shiftTraffic(?:AndWait)?)$/u;

function sdkKind(
  checker: ts.TypeChecker,
  expression: ts.Expression
): "azure" | "kubernetes" | undefined {
  const visited = new Set<ts.Type>();
  const origins = (type: ts.Type): readonly string[] => {
    if (visited.has(type)) return [];
    visited.add(type);
    const symbols = [type.aliasSymbol, type.getSymbol()].filter(
      (symbol): symbol is ts.Symbol => symbol !== undefined
    );
    const own = symbols.flatMap((symbol) =>
      (symbol.declarations ?? []).map((declaration) => declaration.getSourceFile().fileName)
    );
    const nested = type.isUnionOrIntersection() ? type.types.flatMap(origins) : [];
    return [...own, ...nested];
  };
  const paths = origins(checker.getTypeAtLocation(expression)).map((path) =>
    path.replaceAll("\\", "/")
  );
  if (paths.some((path) => path.includes("/node_modules/@azure/arm-"))) return "azure";
  if (paths.some((path) => path.includes("/node_modules/@kubernetes/client-node/"))) {
    return "kubernetes";
  }
  return undefined;
}

interface MethodTarget {
  readonly name?: string;
  readonly receiver?: ts.Expression;
}

function directTarget(expression: ts.Expression): MethodTarget | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    return { name: expression.name.text, receiver: expression.expression };
  }
  if (ts.isElementAccessExpression(expression)) {
    return {
      ...(expression.argumentExpression !== undefined &&
      ts.isStringLiteralLike(expression.argumentExpression)
        ? { name: expression.argumentExpression.text }
        : {}),
      receiver: expression.expression
    };
  }
  return undefined;
}

function callTarget(checker: ts.TypeChecker, expression: ts.Expression): MethodTarget | undefined {
  const direct = directTarget(expression);
  if (direct !== undefined) return direct;
  if (!ts.isIdentifier(expression)) return undefined;
  const symbol = checker.getSymbolAtLocation(expression);
  for (const declaration of symbol?.declarations ?? []) {
    if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
      const target = directTarget(declaration.initializer);
      if (target !== undefined) return target;
    }
    if (ts.isBindingElement(declaration)) {
      const variable = declaration.parent.parent;
      if (ts.isVariableDeclaration(variable) && variable.initializer !== undefined) {
        return {
          name:
            declaration.propertyName !== undefined && ts.isIdentifier(declaration.propertyName)
              ? declaration.propertyName.text
              : ts.isIdentifier(declaration.name)
                ? declaration.name.text
                : undefined,
          receiver: variable.initializer
        };
      }
    }
  }
  return undefined;
}

function inspectProgram(program: ts.Program, root: string): readonly string[] {
  const checker = program.getTypeChecker();
  const violations: string[] = [];
  for (const file of program.getRootFileNames()) {
    const sourceFile = program.getSourceFile(file);
    if (sourceFile === undefined) continue;
    const displayPath = relative(root, file);
    const inspect = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        bannedModules.has(node.moduleSpecifier.text)
      ) {
        violations.push(`${displayPath} imports ${node.moduleSpecifier.text}`);
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          violations.push(`${displayPath} uses dynamic import`);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          violations.push(`${displayPath} uses runtime require`);
        } else {
          const target = callTarget(checker, node.expression);
          const name = target?.name;
          const kind =
            target?.receiver === undefined ? undefined : sdkKind(checker, target.receiver);
          const prohibitedByName =
            name !== undefined && (kubernetesMutation.test(name) || azureMutation.test(name));
          const prohibitedSdkCall =
            kind === "kubernetes"
              ? name === undefined || /^(?:create|delete|patch|replace)/u.test(name)
              : kind === "azure"
                ? name === undefined ||
                  /^(?:beginCreate|beginDelete|beginUpdate|create|delete|restart|start|stop|update)/u.test(
                    name
                  )
                : false;
          if (prohibitedByName || prohibitedSdkCall) {
            violations.push(
              `${displayPath} calls prohibited ${kind ?? "mutation"} method ${name ?? "<computed>"}`
            );
          }
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(sourceFile);
  }
  return violations;
}

function compilerOptions(root: string): ts.CompilerOptions {
  const configPath = join(root, "tsconfig.base.json");
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error !== undefined)
    throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  return ts.parseJsonConfigFileContent(loaded.config, ts.sys, root).options;
}

export function inspectReadOnlyFiles(root: string, paths: readonly string[]): readonly string[] {
  return inspectProgram(ts.createProgram([...paths], compilerOptions(root)), root);
}

export function inspectReadOnlySource(root: string, source: string): readonly string[] {
  const virtualPath = join(root, "tests/security/read-only-negative.ts");
  const options = compilerOptions(root);
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (path) => path === virtualPath || originalFileExists(path);
  host.readFile = (path) => (path === virtualPath ? source : originalReadFile(path));
  host.getSourceFile = (path, languageVersion) => {
    const text = host.readFile(path);
    return text === undefined ? undefined : ts.createSourceFile(path, text, languageVersion, true);
  };
  return inspectProgram(ts.createProgram([virtualPath], options, host), root);
}
