import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createExecutionPlan,
  parsePolicy,
  type GateCatalogMetadata,
  type RawPolicy
} from "../src/index.js";

const catalog: GateCatalogMetadata = {
  "metric.threshold": {
    type: "metric.threshold",
    supportedPhases: ["pre_deployment", "post_deployment"],
    providerRequirements: [{ provider: "metrics", capability: "query", required: true }]
  },
  "kubernetes.manifest": {
    type: "kubernetes.manifest",
    supportedPhases: ["pre_deployment"],
    providerRequirements: []
  },
  "vm.service_health": {
    type: "vm.service_health",
    supportedPhases: ["pre_deployment", "post_deployment"],
    providerRequirements: []
  },
  "evidence.sarif": {
    type: "evidence.sarif",
    supportedPhases: ["pre_deployment"],
    providerRequirements: [{ provider: "static-analysis", capability: "read", required: false }]
  }
};

let policy: RawPolicy;

beforeAll(async () => {
  policy = parsePolicy(await readFile(resolve("fixtures/configs/conditions.yml"), "utf8"));
});

function plan(input: RawPolicy = structuredClone(policy)) {
  return createExecutionPlan({
    policy: input,
    phase: "pre_deployment",
    catalog
  });
}

function expectReferenceFailure(input: RawPolicy): void {
  expect(() => plan(input)).toThrowError(expect.objectContaining({ code: "CONFIG_REFERENCE" }));
}

function gateAt(input: RawPolicy, phase: "pre_deployment" | "post_deployment", index: number) {
  const gate = input.gates[phase][index];
  if (gate === undefined) {
    throw new Error(`Missing ${phase} gate at index ${index}`);
  }
  return gate;
}

function targetRuntime(
  input: RawPolicy,
  targetId: string
): RawPolicy["targets"]["definitions"][string]["runtime"] {
  const target = input.targets.definitions[targetId];
  if (target === undefined) {
    throw new Error(`Missing target ${targetId}`);
  }
  return target.runtime;
}

describe("createExecutionPlan", () => {
  it("preserves gate order and marks target/provider conditions skipped", () => {
    const result = plan();

    expect(result.gates.map((gate) => gate.id)).toEqual([
      "metric.first",
      "kubernetes.only",
      "windows.only",
      "optional.provider"
    ]);
    expect(result.gates.map((gate) => gate.applicability)).toEqual([
      "applicable",
      "skipped",
      "skipped",
      "skipped"
    ]);
  });

  it("skips a Windows gate for a Linux target", () => {
    const input = structuredClone(policy);
    input.execution.active_target = "linux";

    expect(plan(input).gates.find((gate) => gate.id === "windows.only")?.applicability).toBe(
      "skipped"
    );
  });

  it("deduplicates provider requirements and freezes the plan", () => {
    const input = structuredClone(policy);
    input.gates.pre_deployment.push({
      id: "metric.second",
      name: "Second metric",
      type: "metric.threshold",
      source: { provider: "metrics" }
    });

    const result = plan(input);

    expect(result.requiredProviders).toEqual([
      { provider: "metrics", capability: "query", required: true }
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.gates)).toBe(true);
    expect(Object.isFrozen(result.gates[0])).toBe(true);
  });

  it("rejects unknown targets, runtime providers, gate types, and source providers", () => {
    const unknownTarget = structuredClone(policy);
    unknownTarget.execution.active_target = "missing";
    expectReferenceFailure(unknownTarget);

    const unknownRuntimeProvider = structuredClone(policy);
    targetRuntime(unknownRuntimeProvider, "aca").provider = "missing";
    expectReferenceFailure(unknownRuntimeProvider);

    const unknownGate = structuredClone(policy);
    gateAt(unknownGate, "pre_deployment", 0).type = "unknown.gate";
    expectReferenceFailure(unknownGate);

    const unknownSourceProvider = structuredClone(policy);
    gateAt(unknownSourceProvider, "pre_deployment", 0).source = { provider: "missing" };
    expectReferenceFailure(unknownSourceProvider);
  });

  it("rejects unknown output and applicable target-property references", () => {
    const unknownOutput = structuredClone(policy);
    unknownOutput.reporting.outputs = ["decision", "unknown_output"];
    expectReferenceFailure(unknownOutput);

    const unknownTargetProperty = structuredClone(policy);
    gateAt(unknownTargetProperty, "pre_deployment", 0).source = {
      provider: "metrics",
      threshold: "target.runtime.expected.never_defined"
    };
    expectReferenceFailure(unknownTargetProperty);
  });

  it("rejects duplicate gate IDs and unsupported condition keys", () => {
    const duplicate = structuredClone(policy);
    gateAt(duplicate, "pre_deployment", 1).id = "metric.first";
    expectReferenceFailure(duplicate);

    const badCondition = structuredClone(policy);
    gateAt(badCondition, "pre_deployment", 0).when = { region: "east" };
    expectReferenceFailure(badCondition);
  });

  it("requires at least one blocking post-deployment gate", () => {
    const input = structuredClone(policy);
    gateAt(input, "post_deployment", 0).enforcement = "advisory";

    expect(() =>
      createExecutionPlan({ policy: input, phase: "post_deployment", catalog })
    ).toThrowError(expect.objectContaining({ code: "CONFIG_REFERENCE" }));
  });
});
