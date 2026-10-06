import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceStore, type Evidence, type Phase } from "@observability-gate/core";
import { GateCatalog, registerContainerAppsGates, type GateContext } from "../../../src/index.js";

type Value = Record<string, unknown>;
let healthyPre: Value;
let healthyPost: Value;

beforeAll(async () => {
  const value = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../../fixtures/repositories/container-apps-pass/evidence.json",
          import.meta.url
        )
      ),
      "utf8"
    )
  ) as { pre: Value; post: Value };
  healthyPre = value.pre;
  healthyPost = value.post;
});

function nested(value: Value, field: string): Value {
  const result = value[field];
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new TypeError(`Fixture field ${field} is not an object`);
  return result as Value;
}

function evaluate(type: string, phase: Phase, value: Value) {
  const context: GateContext = {
    phase,
    targetId: "aca-order",
    evidenceStore: new EvidenceStore(),
    signal: new AbortController().signal,
    clock: () => new Date("2026-10-06T08:10:00Z"),
    missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
  };
  const evidence: Evidence<unknown> = {
    id: "aca",
    kind: type,
    state: "valid",
    source: { provider: "azure", capability: type },
    target: context.targetId,
    acquiredAt: context.clock().toISOString(),
    value,
    diagnostics: []
  };
  return registerContainerAppsGates(new GateCatalog())
    .require(type, phase, {})
    .evaluate([evidence], context);
}

describe("Azure Container Apps platform catalogue", () => {
  it("resolves and passes all Container Apps gate types", () => {
    const pre = ["azure_container_apps.configuration", "azure_container_apps.probes"];
    const post = [
      "azure_container_apps.revision_status",
      "azure_container_apps.image_identity",
      "azure_container_apps.traffic",
      "azure_container_apps.replica_health"
    ];
    const catalog = registerContainerAppsGates(new GateCatalog());
    for (const type of pre) {
      expect(catalog.require(type, "pre_deployment", {}).metadata.type).toBe(type);
      expect(
        evaluate(type, "pre_deployment", healthyPre).every((item) => item.status === "passed"),
        type
      ).toBe(true);
    }
    for (const type of post) {
      expect(catalog.require(type, "post_deployment", {}).metadata.type).toBe(type);
      expect(
        evaluate(type, "post_deployment", healthyPost).every((item) => item.status === "passed"),
        type
      ).toBe(true);
    }
  });

  it.each([
    [
      "digest pinning",
      "azure_container_apps.configuration",
      (value: Value) => {
        value.image = "repo/app:latest";
      }
    ],
    [
      "Multiple revision mode",
      "azure_container_apps.configuration",
      (value: Value) => {
        value.revisionMode = "Single";
      }
    ],
    [
      "ingress transport",
      "azure_container_apps.configuration",
      (value: Value) => {
        delete value.ingressTransport;
      }
    ],
    [
      "minimum replicas",
      "azure_container_apps.configuration",
      (value: Value) => {
        value.minimumReplicas = 1;
      }
    ],
    [
      "maximum replicas",
      "azure_container_apps.configuration",
      (value: Value) => {
        value.maximumReplicas = 1;
      }
    ],
    [
      "OTel environment",
      "azure_container_apps.configuration",
      (value: Value) => {
        value.otelEnvironment = {};
      }
    ],
    [
      "managed identity",
      "azure_container_apps.configuration",
      (value: Value) => {
        value.managedIdentity = "None";
      }
    ],
    [
      "startup probe",
      "azure_container_apps.probes",
      (value: Value) => {
        value.probes = (value.probes as Value[]).filter((probe) => probe.type !== "Startup");
      }
    ],
    [
      "readiness probe",
      "azure_container_apps.probes",
      (value: Value) => {
        value.probes = (value.probes as Value[]).filter((probe) => probe.type !== "Readiness");
      }
    ],
    [
      "liveness probe",
      "azure_container_apps.probes",
      (value: Value) => {
        value.probes = (value.probes as Value[]).filter((probe) => probe.type !== "Liveness");
      }
    ],
    [
      "probe port",
      "azure_container_apps.probes",
      (value: Value) => {
        nested((value.probes as Value[])[0] as Value, "httpGet").port = 9090;
      }
    ]
  ])("fails pre-deployment %s with exact JSON paths", (_case, type, mutate) => {
    const value = structuredClone(healthyPre);
    mutate(value);
    const failed = evaluate(type, "pre_deployment", value).filter(
      (item) => item.status === "failed"
    );
    expect(failed.length).toBeGreaterThan(0);
    for (const result of failed)
      expect(result.observed).toEqual(
        expect.objectContaining({ path: expect.stringMatching(/^\$/) })
      );
  });

  it.each([
    [
      "provisioning failed",
      "azure_container_apps.revision_status",
      (value: Value) => {
        value.provisioningState = "Failed";
      }
    ],
    [
      "running degraded",
      "azure_container_apps.revision_status",
      (value: Value) => {
        nested(value, "revision").runningState = "Degraded";
      }
    ],
    [
      "inactive revision",
      "azure_container_apps.revision_status",
      (value: Value) => {
        nested(value, "revision").active = false;
      }
    ],
    [
      "insufficient healthy replicas",
      "azure_container_apps.revision_status",
      (value: Value) => {
        nested(value, "replicas").healthy = 1;
      }
    ],
    [
      "failed replicas",
      "azure_container_apps.revision_status",
      (value: Value) => {
        nested(value, "replicas").failed = 1;
      }
    ],
    [
      "image mismatch",
      "azure_container_apps.image_identity",
      (value: Value) => {
        nested(value, "revision").imageDigest =
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      }
    ],
    [
      "revision suffix mismatch",
      "azure_container_apps.image_identity",
      (value: Value) => {
        nested(value, "revision").suffix = "old";
      }
    ],
    [
      "candidate traffic below minimum",
      "azure_container_apps.traffic",
      (value: Value) => {
        nested(value, "traffic").candidateWeight = 0;
      }
    ],
    [
      "unknown revision traffic",
      "azure_container_apps.traffic",
      (value: Value) => {
        nested(value, "traffic").unknownRevisionWeight = 10;
      }
    ],
    [
      "traffic weights total",
      "azure_container_apps.traffic",
      (value: Value) => {
        nested(value, "traffic").totalWeight = 90;
      }
    ],
    [
      "restarts",
      "azure_container_apps.replica_health",
      (value: Value) => {
        nested(value, "replicas").restartIncrease = 1;
      }
    ],
    [
      "activation failures",
      "azure_container_apps.replica_health",
      (value: Value) => {
        nested(value, "replicas").activationFailures = 1;
      }
    ],
    [
      "deactivation failures",
      "azure_container_apps.replica_health",
      (value: Value) => {
        nested(value, "replicas").deactivationFailures = 1;
      }
    ]
  ])("detects post-deployment %s", (_case, type, mutate) => {
    const value = structuredClone(healthyPost);
    mutate(value);
    expect(evaluate(type, "post_deployment", value).some((item) => item.status === "failed")).toBe(
      true
    );
  });
});
