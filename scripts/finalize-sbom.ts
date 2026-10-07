import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  bundledPackages,
  deterministicSerial,
  npmPurl,
  type BundledPackage
} from "./bundle-dependencies.ts";

function component(item: BundledPackage) {
  const slash = item.name.startsWith("@") ? item.name.indexOf("/") : -1;
  const purl = npmPurl(item.name, item.version);
  const integrity = item.integrity?.match(/^sha512-(.+)$/u)?.[1];
  return {
    "bom-ref": purl,
    type: "library",
    ...(slash === -1 ? {} : { group: item.name.slice(0, slash) }),
    name: slash === -1 ? item.name : item.name.slice(slash + 1),
    version: item.version,
    ...(item.license === undefined ? {} : { licenses: [{ license: { id: item.license } }] }),
    ...(integrity === undefined
      ? {}
      : {
          hashes: [{ alg: "SHA-512", content: Buffer.from(integrity, "base64").toString("hex") }]
        }),
    ...(item.resolved === undefined
      ? {}
      : { externalReferences: [{ type: "distribution", url: item.resolved }] }),
    purl
  };
}

export function finalizeCycloneDx(
  sbom: Record<string, unknown>,
  sourceMap: Parameters<typeof bundledPackages>[0],
  lock: Parameters<typeof bundledPackages>[1],
  sourceDateEpoch?: string
): Record<string, unknown> {
  const dependencies = bundledPackages(sourceMap, lock);
  const metadata =
    typeof sbom.metadata === "object" && sbom.metadata !== null
      ? (sbom.metadata as Record<string, unknown>)
      : {};
  const root =
    typeof metadata.component === "object" && metadata.component !== null
      ? (metadata.component as Record<string, unknown>)
      : {};
  const rootReference = typeof root["bom-ref"] === "string" ? root["bom-ref"] : "observegate-cli";
  const identity = dependencies.map((item) => `${item.name}@${item.version}`).join("\n");
  const timestamp =
    sourceDateEpoch === undefined
      ? metadata.timestamp
      : new Date(Number(sourceDateEpoch) * 1_000).toISOString();
  return {
    ...sbom,
    serialNumber: deterministicSerial(
      `${String(root.name ?? "@shipsolid/observegate")}@${String(root.version ?? "unknown")}\n${identity}`
    ),
    metadata: {
      ...metadata,
      ...(timestamp === undefined ? {} : { timestamp }),
      component: { ...root, type: "application" }
    },
    components: dependencies.map(component),
    dependencies: [
      {
        ref: rootReference,
        dependsOn: dependencies.map((item) => npmPurl(item.name, item.version))
      }
    ]
  };
}

export async function finalizeSbom(
  sbomPath: string,
  sourceMapPath: string,
  lockPath: string
): Promise<void> {
  const [sbom, sourceMap, lock] = await Promise.all(
    [sbomPath, sourceMapPath, lockPath].map(
      async (path) => JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
    )
  );
  const finalized = finalizeCycloneDx(sbom, sourceMap, lock, process.env.SOURCE_DATE_EPOCH);
  await writeFile(sbomPath, `${JSON.stringify(finalized, null, 2)}\n`, "utf8");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  const [sbomPath, sourceMapPath, lockPath] = process.argv.slice(2);
  if (sbomPath === undefined || sourceMapPath === undefined || lockPath === undefined) {
    process.stderr.write("Usage: finalize-sbom <sbom.json> <bundle.js.map> <package-lock.json>\n");
    process.exitCode = 1;
  } else {
    await finalizeSbom(sbomPath, sourceMapPath, lockPath);
  }
}
