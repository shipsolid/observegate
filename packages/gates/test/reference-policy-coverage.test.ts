import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "@observability-gate/config";
import { createBuiltInGateCatalog } from "../src/index.js";

async function policy() {
  return parsePolicy(
    await readFile(
      fileURLToPath(new URL("../../../examples/observability-gate.yml", import.meta.url)),
      "utf8"
    )
  );
}

describe("reference policy gate coverage", () => {
  it("resolves and parses every one of the 86 reference gate IDs", async () => {
    const value = await policy();
    const catalog = createBuiltInGateCatalog();
    const all = [...value.gates.pre_deployment, ...value.gates.post_deployment];
    expect(value.gates.pre_deployment).toHaveLength(39);
    expect(value.gates.post_deployment).toHaveLength(47);
    expect(new Set(all.map((gate) => gate.id)).size).toBe(86);
    for (const [phase, gates] of [
      ["pre_deployment", value.gates.pre_deployment],
      ["post_deployment", value.gates.post_deployment]
    ] as const) {
      for (const gate of gates) {
        const resolved = catalog.require(gate.type, phase, gate);
        expect(resolved.metadata.supportedPhases, gate.id).toContain(phase);
        expect(resolved.definition, gate.id).toBeDefined();
      }
    }
  });

  it("declares supported conditions and configured provider families", async () => {
    const value = await policy();
    const catalog = createBuiltInGateCatalog();
    const metadata = catalog.metadata();
    const supportedConditions = new Set(["runtime_type", "operating_system", "provider_available"]);
    const providerFamilies = new Set<string>();
    for (const group of Object.values(value.providers)) {
      for (const [id, definition] of Object.entries(group)) {
        providerFamilies.add(id);
        if (typeof definition.type === "string") providerFamilies.add(definition.type);
      }
    }
    for (const gate of [...value.gates.pre_deployment, ...value.gates.post_deployment]) {
      for (const key of Object.keys(gate.when ?? {}))
        expect(supportedConditions, gate.id).toContain(key);
      for (const requirement of metadata[gate.type]?.providerRequirements ?? []) {
        expect(providerFamilies, `${gate.id}: ${requirement.provider}`).toContain(
          requirement.provider
        );
      }
    }
  });

  it("covers every required blocking post-deployment category", async () => {
    const value = await policy();
    const readiness = value.gates.pre_deployment.find(
      (gate) => gate.id === "readiness.post-gate-coverage"
    );
    const assertions = readiness?.assertions as Readonly<Record<string, unknown>> | undefined;
    const required = Array.isArray(assertions?.require_blocking_categories)
      ? assertions.require_blocking_categories.map(String)
      : [];
    const actual = new Set(
      value.gates.post_deployment
        .filter((gate) => gate.enforcement !== "advisory")
        .map((gate) => gate.category)
        .filter((category): category is string => typeof category === "string")
    );
    expect(required).not.toHaveLength(0);
    for (const category of required) expect(actual).toContain(category);
  });

  it("publishes a stable, complete catalogue metadata snapshot", () => {
    const metadata = createBuiltInGateCatalog().metadata();
    expect(Object.keys(metadata)).toEqual([...Object.keys(metadata)].sort());
    for (const item of Object.values(metadata)) {
      expect(item).toMatchObject({
        type: expect.any(String),
        description: expect.any(String),
        supportedPhases: expect.any(Array),
        providerRequirements: expect.any(Array),
        conditionKeys: ["phase", "runtime_type", "operating_system", "provider_available"],
        assertionSchema: "normalized-evidence/v1",
        supportsRemediation: true
      });
    }
    expect(metadata).toMatchSnapshot();
  });
});
