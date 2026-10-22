import {
  GateError,
  stableFingerprint,
  type Evidence,
  type ProviderSession
} from "@observability-gate/core";
import type { ProviderPolicy } from "../session.js";
import type { SafeEvidenceFileLoader } from "../evidence/files.js";

export type Data = Readonly<Record<string, unknown>>;
export type Context = Parameters<NonNullable<ProviderSession["resolveEvidence"]>>[2];
export const record = (value: unknown): Data =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Data) : {};
export const array = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
export const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;
export const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
export function durationMs(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/u.exec(value);
  return match === null
    ? fallback
    : Number(match[1]) *
        ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2] ?? ""] ?? 1);
}
export function configuration(message: string): never {
  throw new GateError({ code: "CONFIG_REFERENCE", safeMessage: message, retryable: false });
}
export function invalid(message: string): never {
  throw new GateError({ code: "EVIDENCE_INVALID", safeMessage: message, retryable: false });
}
export function field(
  value: Data,
  key: string,
  env: Readonly<Record<string, string | undefined>>
): string | undefined {
  return string(value[key]) ?? env[String(value[`${key}_env`] ?? "")];
}
export function evidence(
  kind: string,
  context: Context,
  at: string,
  value: unknown,
  provider = "policy",
  capability = kind
): Evidence<unknown> {
  return Object.freeze({
    id: stableFingerprint({ kind, target: context.targetId, at, value }),
    kind,
    state: "valid",
    source: Object.freeze({ provider, capability }),
    target: context.targetId,
    ...(context.releaseId === undefined ? {} : { releaseId: context.releaseId }),
    acquiredAt: at,
    value,
    diagnostics: Object.freeze([])
  });
}
export function mapped(raw: Evidence<unknown>, kind: string, value: unknown): Evidence<unknown> {
  return Object.freeze({
    ...raw,
    id: stableFingerprint({ source: raw.id, kind, value }),
    kind,
    value
  });
}
export function combined(
  raw: readonly Evidence<unknown>[],
  kind: string,
  value: unknown
): Evidence<unknown> {
  const base = raw.find((item) => item.state !== "valid") ?? raw[0];
  if (base === undefined)
    return configuration(`${kind} requires at least one acquired evidence source`);
  return mapped(base, kind, value);
}
export function identity(policy: ProviderPolicy): Data {
  const v = record(policy.identity.canonical);
  return {
    serviceName: v.service_name,
    serviceNamespace: v.service_namespace,
    environment: v.environment,
    releaseId: v.release_id
  };
}
export function matches(observed: Data, expected: Data): boolean {
  return (
    observed.serviceName === expected.serviceName &&
    observed.serviceNamespace === expected.serviceNamespace &&
    observed.deploymentEnvironment === expected.environment &&
    observed.serviceVersion === expected.releaseId
  );
}
export function activeRuntime(policy: ProviderPolicy): Data {
  const id = string(policy.execution.active_target);
  return record(record(record(policy.targets.definitions)[id ?? ""]).runtime);
}
export interface ResolverBase {
  readonly policy: ProviderPolicy;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly files: SafeEvidenceFileLoader;
  readonly now: () => number;
  readonly maximumFutureSkewMs: number;
}
export async function loadFiles(
  base: ResolverBase,
  definition: Data,
  fallback?: readonly unknown[]
) {
  const source = record(definition.source);
  const provider = record(record(base.policy.providers.evidence)[String(source.provider)]);
  const paths =
    typeof source.file === "string"
      ? [source.file]
      : array(source.files).length > 0
        ? array(source.files)
        : array(provider.files).length > 0
          ? array(provider.files)
          : (fallback ?? []);
  if (paths.length === 0)
    configuration(
      `${String(definition.type ?? "Gate")} requires source.files or a provider with explicit files`
    );
  const loaded = await Promise.all(
    paths.map((path) =>
      base.files.load({
        path: String(path),
        blocking: definition.enforcement !== "advisory",
        maximumAgeMs: durationMs(provider.maximum_age, 24 * 3600000),
        maximumFutureSkewMs: base.maximumFutureSkewMs
      })
    )
  );
  const first = loaded.shift();
  if (first === undefined) configuration("Evidence file list is empty");
  return [first, ...loaded] as const;
}
