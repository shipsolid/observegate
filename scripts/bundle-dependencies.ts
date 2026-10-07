import { createHash } from "node:crypto";

export interface BundledPackage {
  readonly name: string;
  readonly version: string;
  readonly license?: string;
  readonly resolved?: string;
  readonly integrity?: string;
}

interface SourceMap {
  readonly sources?: unknown;
}

interface LockPackage {
  readonly version?: unknown;
  readonly license?: unknown;
  readonly resolved?: unknown;
  readonly integrity?: unknown;
}

interface PackageLock {
  readonly packages?: Readonly<Record<string, LockPackage>>;
}

function packageName(source: string): string | undefined {
  const normalized = source.replaceAll("\\", "/");
  const marker = "node_modules/";
  const offset = normalized.lastIndexOf(marker);
  if (offset === -1) return undefined;
  const segments = normalized.slice(offset + marker.length).split("/");
  if (segments[0]?.startsWith("@")) {
    return segments[0] !== undefined && segments[1] !== undefined
      ? `${segments[0]}/${segments[1]}`
      : undefined;
  }
  return segments[0];
}

export function bundledPackages(
  sourceMap: SourceMap,
  lock: PackageLock
): readonly BundledPackage[] {
  if (!Array.isArray(sourceMap.sources)) throw new Error("CLI source map has no sources array");
  const names = new Set(
    sourceMap.sources.flatMap((source) => {
      if (typeof source !== "string") return [];
      const name = packageName(source);
      return name === undefined ? [] : [name];
    })
  );
  return [...names].sort().map((name) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    if (entry === undefined || typeof entry.version !== "string") {
      throw new Error(`Bundled package ${name} is absent from package-lock.json`);
    }
    return Object.freeze({
      name,
      version: entry.version,
      ...(typeof entry.license === "string" ? { license: entry.license } : {}),
      ...(typeof entry.resolved === "string" ? { resolved: entry.resolved } : {}),
      ...(typeof entry.integrity === "string" ? { integrity: entry.integrity } : {})
    });
  });
}

export function npmPurl(name: string, version: string): string {
  const separator = name.startsWith("@") ? name.indexOf("/") : -1;
  const encodedName =
    separator === -1
      ? encodeURIComponent(name)
      : `${encodeURIComponent(name.slice(0, separator))}/${encodeURIComponent(name.slice(separator + 1))}`;
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

export function deterministicSerial(identity: string): string {
  const digest = createHash("sha256").update(identity).digest("hex");
  const variant = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
