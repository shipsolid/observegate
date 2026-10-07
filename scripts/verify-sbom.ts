import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

interface Component {
  readonly name?: unknown;
  readonly group?: unknown;
  readonly version?: unknown;
  readonly purl?: unknown;
  readonly components?: unknown;
}

interface CycloneDx {
  readonly bomFormat?: unknown;
  readonly specVersion?: unknown;
  readonly metadata?: { readonly component?: unknown };
  readonly components?: unknown;
}

function components(value: unknown): readonly Component[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const component = entry as Component;
    return [component, ...components(component.components)];
  });
}

function identity(component: Component): string {
  if (typeof component.group === "string" && component.group.length > 0) {
    return `${component.group}/${String(component.name ?? "")}`;
  }
  return typeof component.name === "string" ? component.name : "";
}

export function inspectCycloneDx(
  sbom: CycloneDx,
  manifest: { readonly name?: unknown; readonly version?: unknown }
): readonly string[] {
  const violations: string[] = [];
  if (sbom.bomFormat !== "CycloneDX") violations.push("SBOM format must be CycloneDX");
  if (typeof sbom.specVersion !== "string") violations.push("SBOM specVersion is missing");
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    return [...violations, "package manifest identity is invalid"];
  }

  const all = [
    ...(typeof sbom.metadata?.component === "object" && sbom.metadata.component !== null
      ? [sbom.metadata.component as Component]
      : []),
    ...components(sbom.components)
  ];
  const packagePurl = `pkg:npm/${encodeURIComponent(manifest.name)}@${manifest.version}`;
  const product = all.find(
    (component) =>
      component.version === manifest.version &&
      (identity(component) === manifest.name || component.purl === packagePurl)
  );
  if (product === undefined) {
    violations.push(`SBOM does not identify ${manifest.name}@${manifest.version}`);
  }

  for (const component of all) {
    const name = identity(component);
    const purl = typeof component.purl === "string" ? component.purl : "";
    if (name.startsWith("@actions/") || purl.includes("%40actions/")) {
      violations.push(`SBOM contains Action-only package ${name || purl}`);
    }
  }
  return violations;
}

export async function verifySbom(sbomPath: string, manifestPath: string): Promise<void> {
  const [sbomText, manifestText] = await Promise.all([
    readFile(sbomPath, "utf8"),
    readFile(manifestPath, "utf8")
  ]);
  const violations = inspectCycloneDx(
    JSON.parse(sbomText) as CycloneDx,
    JSON.parse(manifestText) as { readonly name?: unknown; readonly version?: unknown }
  );
  if (violations.length > 0) throw new Error(violations.join("\n"));
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const sbomPath = process.argv[2];
  const manifestPath = process.argv[3];
  if (sbomPath === undefined || manifestPath === undefined) {
    process.stderr.write("Usage: verify-sbom <sbom.json> <package.json>\n");
    process.exitCode = 1;
  } else {
    try {
      await verifySbom(sbomPath, manifestPath);
      process.stdout.write("verify:sbom: artifact identity and dependency boundary verified\n");
    } catch (error) {
      process.stderr.write(`verify:sbom: ${error instanceof Error ? error.message : "failed"}\n`);
      process.exitCode = 1;
    }
  }
}
