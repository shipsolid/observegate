import { describe, expect, it } from "vitest";
import type { Evidence, GateTypeMetadata } from "@observability-gate/core";
import { GateCatalog, type GateTypeDefinition } from "../src/index.js";

interface ThresholdDefinition {
  readonly threshold: number;
}

function thresholdGate(type = "metric.threshold"): GateTypeDefinition<ThresholdDefinition, number> {
  return {
    type,
    description: "Compare a metric with a threshold.",
    supportedPhases: ["pre_deployment", "post_deployment"],
    providerRequirements: [{ provider: "metrics", capability: "query", required: true }],
    parseDefinition(input) {
      if (
        input === null ||
        typeof input !== "object" ||
        !("threshold" in input) ||
        typeof input.threshold !== "number"
      ) {
        throw new Error("threshold is required");
      }
      return { threshold: input.threshold };
    },
    async acquire() {
      return [] as readonly Evidence<number>[];
    },
    evaluate() {
      return [];
    }
  };
}

describe("GateCatalog", () => {
  it("rejects duplicate gate type registration", () => {
    const catalog = new GateCatalog();
    catalog.register(thresholdGate());

    expect(() => catalog.register(thresholdGate())).toThrowError(
      expect.objectContaining({ code: "CONFIG_REFERENCE" })
    );
  });

  it("rejects unknown and phase-incompatible types", () => {
    const catalog = new GateCatalog();
    catalog.register(thresholdGate());

    expect(() => catalog.require("missing", "pre_deployment", {})).toThrowError(
      expect.objectContaining({ code: "CAPABILITY_UNSUPPORTED" })
    );
    const postOnly = thresholdGate("post.only");
    catalog.register({ ...postOnly, supportedPhases: ["post_deployment"] });
    expect(() => catalog.require("post.only", "pre_deployment", { threshold: 1 })).toThrowError(
      expect.objectContaining({ code: "CAPABILITY_UNSUPPORTED" })
    );
  });

  it("runs the gate-specific definition parser", () => {
    const catalog = new GateCatalog();
    catalog.register(thresholdGate());

    expect(() => catalog.require("metric.threshold", "pre_deployment", {})).toThrowError(
      "threshold is required"
    );
    expect(
      catalog.require("metric.threshold", "pre_deployment", { threshold: 5 }).definition
    ).toEqual({ threshold: 5 });
  });

  it("returns sorted frozen metadata without evaluator functions", () => {
    const catalog = new GateCatalog();
    catalog.register(thresholdGate("z.type"));
    catalog.register(thresholdGate("a.type"));

    const metadata = catalog.metadata();

    expect(Object.keys(metadata)).toEqual(["a.type", "z.type"]);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.values(metadata).every((item: GateTypeMetadata) => !("acquire" in item))).toBe(
      true
    );
  });
});
