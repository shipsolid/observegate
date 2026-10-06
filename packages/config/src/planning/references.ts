import { isAbsolute } from "node:path";
import { GateError, type Phase } from "@observability-gate/core";
import type { RawGateEnvelope } from "../schema/gate-envelope.js";
import type { RawPolicy } from "../schema/policy.js";

const outputNames = new Set([
  "decision",
  "phase",
  "target_id",
  "release_id",
  "baseline_release_id",
  "passed_count",
  "warned_count",
  "failed_count",
  "skipped_count",
  "evidence_coverage_percent",
  "report_path"
]);
const environmentNamePattern = /^[A-Z][A-Z0-9_]*$/;
const prohibitedPathKeys = new Set(["__proto__", "prototype", "constructor"]);

function referenceError(message: string): never {
  throw new GateError({
    code: "CONFIG_REFERENCE",
    safeMessage: message,
    retryable: false
  });
}

export function collectProviders(policy: RawPolicy): ReadonlySet<string> {
  return new Set(
    Object.values(policy.providers).flatMap((group) =>
      group === undefined ? [] : Object.keys(group)
    )
  );
}

function visit(value: unknown, visitor: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, visitor);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child);
    visit(child, visitor);
  }
}

function validateEnvironmentNames(policy: RawPolicy): void {
  visit(policy, (key, value) => {
    if (key.endsWith("_env") && typeof value === "string" && !environmentNamePattern.test(value)) {
      referenceError(`Invalid environment variable name: ${value}`);
    }
  });
}

function validateFilePaths(policy: RawPolicy): void {
  visit(policy.providers, (key, value) => {
    if (key !== "files" || !Array.isArray(value)) {
      return;
    }
    for (const file of value) {
      if (typeof file !== "string") {
        referenceError("Evidence file paths must be strings.");
      }
      const segments = file.split(/[\\/]/u);
      if (isAbsolute(file) || /^[A-Za-z]:[\\/]/u.test(file) || segments.includes("..")) {
        referenceError(`Evidence file path must stay inside the workspace: ${file}`);
      }
    }
  });
}

function validateOutputsAndLinks(policy: RawPolicy): void {
  for (const output of policy.reporting.outputs ?? []) {
    if (typeof output !== "string" || !outputNames.has(output)) {
      referenceError(`Unknown report output: ${String(output)}`);
    }
  }
  const links = policy.reporting.links;
  if (links !== undefined) {
    for (const [name, environmentName] of Object.entries(links)) {
      if (typeof environmentName !== "string" || !environmentNamePattern.test(environmentName)) {
        referenceError(`Invalid report-link environment reference: ${name}`);
      }
    }
  }
}

function hasOwnPath(root: unknown, path: readonly string[]): boolean {
  let current = root;
  for (const segment of path) {
    if (
      prohibitedPathKeys.has(segment) ||
      current === null ||
      typeof current !== "object" ||
      !Object.hasOwn(current, segment)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function validateTargetReferences(gate: RawGateEnvelope, policy: RawPolicy): void {
  visit(gate, (_key, value) => {
    if (typeof value !== "string" || !value.startsWith("target.")) {
      return;
    }
    const path = value.split(".").slice(1);
    if (path.length === 0 || prohibitedPathKeys.has(path[0] ?? "")) {
      referenceError(`Invalid target property reference in gate ${gate.id}: ${value}`);
    }
    const known = Object.values(policy.targets.definitions).some((target) =>
      hasOwnPath(target, path)
    );
    if (!known) {
      referenceError(`Unknown target property reference in gate ${gate.id}: ${value}`);
    }
  });
}

export function validatePolicyReferences(
  policy: RawPolicy,
  phase: Phase,
  activeTargetId: string,
  applicableGates: ReadonlySet<string>,
  knownGateTypes: ReadonlySet<string>,
  supportedPhases: ReadonlyMap<string, readonly Phase[]>
): void {
  const target = policy.targets.definitions[activeTargetId];
  if (target === undefined) {
    referenceError(`Unknown active target: ${activeTargetId}`);
  }

  const providers = collectProviders(policy);
  const runtimeProvider = target.runtime.provider;
  if (typeof runtimeProvider !== "string" || !providers.has(runtimeProvider)) {
    referenceError(
      `Unknown runtime provider for target ${activeTargetId}: ${String(runtimeProvider)}`
    );
  }

  const gates = policy.gates[phase];
  const seenGateIds = new Set<string>();
  for (const gate of gates) {
    if (seenGateIds.has(gate.id)) {
      referenceError(`Duplicate gate ID: ${gate.id}`);
    }
    seenGateIds.add(gate.id);

    if (!knownGateTypes.has(gate.type)) {
      referenceError(`Unknown gate type: ${gate.type}`);
    }
    if (!supportedPhases.get(gate.type)?.includes(phase)) {
      referenceError(`Gate type ${gate.type} does not support phase ${phase}`);
    }
    if (!applicableGates.has(gate.id)) {
      continue;
    }

    visit(gate, (key, value) => {
      if (key === "provider" && typeof value === "string" && !providers.has(value)) {
        referenceError(`Unknown source provider in gate ${gate.id}: ${value}`);
      }
    });
    validateTargetReferences(gate, policy);
  }

  validateEnvironmentNames(policy);
  validateFilePaths(policy);
  validateOutputsAndLinks(policy);
}
