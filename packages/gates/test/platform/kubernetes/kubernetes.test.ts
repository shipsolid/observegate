import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { EvidenceStore, type Evidence, type Phase } from "@observability-gate/core";
import { GateCatalog, registerKubernetesGates, type GateContext } from "../../../src/index.js";

type Value = Record<string, unknown>;
let healthyPre: Value;
let healthyPost: Value;

beforeAll(async () => {
  const parsed = JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          "../../../../../fixtures/repositories/kubernetes-pass/evidence.json",
          import.meta.url
        )
      ),
      "utf8"
    )
  ) as { pre: Value; post: Value };
  healthyPre = parsed.pre;
  healthyPost = parsed.post;
});

function evaluate(type: string, phase: Phase, value: Value) {
  const context: GateContext = {
    phase,
    targetId: "prod-checkout",
    evidenceStore: new EvidenceStore(),
    signal: new AbortController().signal,
    clock: () => new Date("2026-10-06T08:10:00Z"),
    missingEvidenceBehavior: { blocking: "fail", advisory: "warn" }
  };
  const evidence: Evidence<unknown> = {
    id: "kubernetes-evidence",
    kind: type,
    state: "valid",
    source: { provider: "kubernetes", capability: type },
    target: context.targetId,
    acquiredAt: context.clock().toISOString(),
    value,
    diagnostics: []
  };
  return registerKubernetesGates(new GateCatalog())
    .require(type, phase, {})
    .evaluate([evidence], context);
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function entry(value: Value, field: string, index = 0): Value {
  const collection = value[field];
  const item = Array.isArray(collection) ? collection[index] : undefined;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new TypeError(`Fixture field ${field}[${index}] is not an object`);
  }
  return item as Value;
}

describe("Kubernetes platform catalogue", () => {
  it("resolves all pre- and post-deployment Kubernetes gate types", () => {
    const catalog = registerKubernetesGates(new GateCatalog());
    for (const type of [
      "kubernetes.manifest",
      "kubernetes.probes",
      "kubernetes.resources",
      "kubernetes.rollout_strategy"
    ]) {
      expect(catalog.require(type, "pre_deployment", {}).metadata.type).toBe(type);
    }
    for (const type of [
      "kubernetes.rollout_status",
      "kubernetes.image_identity",
      "kubernetes.pod_health",
      "kubernetes.events"
    ]) {
      expect(catalog.require(type, "post_deployment", {}).metadata.type).toBe(type);
    }
  });

  it("passes the complete healthy Kubernetes fixture", () => {
    for (const type of [
      "kubernetes.manifest",
      "kubernetes.probes",
      "kubernetes.resources",
      "kubernetes.rollout_strategy"
    ]) {
      expect(
        evaluate(type, "pre_deployment", healthyPre).every((item) => item.status === "passed"),
        type
      ).toBe(true);
    }
    for (const type of [
      "kubernetes.rollout_status",
      "kubernetes.image_identity",
      "kubernetes.pod_health",
      "kubernetes.events"
    ]) {
      expect(
        evaluate(type, "post_deployment", healthyPost).every((item) => item.status === "passed"),
        type
      ).toBe(true);
    }
  });

  it.each([
    [
      "latest image",
      "kubernetes.manifest",
      (value: Value) => {
        value.image = "repo/app:latest";
      }
    ],
    [
      "non-digest image",
      "kubernetes.manifest",
      (value: Value) => {
        value.image = "repo/app:v1";
      }
    ],
    [
      "privileged container",
      "kubernetes.manifest",
      (value: Value) => {
        (value.containerSecurityContext as Value).privileged = true;
      }
    ],
    [
      "writable root filesystem",
      "kubernetes.manifest",
      (value: Value) => {
        (value.containerSecurityContext as Value).readOnlyRootFilesystem = false;
      }
    ],
    [
      "missing readiness",
      "kubernetes.probes",
      (value: Value) => {
        delete value.readinessProbe;
      }
    ],
    [
      "missing liveness",
      "kubernetes.probes",
      (value: Value) => {
        delete value.livenessProbe;
      }
    ],
    [
      "missing startup",
      "kubernetes.probes",
      (value: Value) => {
        delete value.startupProbe;
      }
    ],
    [
      "probe timeout",
      "kubernetes.probes",
      (value: Value) => {
        (value.readinessProbe as Value).timeoutSeconds = 6;
      }
    ],
    [
      "missing requests",
      "kubernetes.resources",
      (value: Value) => {
        delete (value.resources as Value).requests;
      }
    ],
    [
      "missing memory limit",
      "kubernetes.resources",
      (value: Value) => {
        delete ((value.resources as Value).limits as Value).memory;
      }
    ],
    [
      "one production replica",
      "kubernetes.resources",
      (value: Value) => {
        value.replicas = 1;
      }
    ],
    [
      "missing disruption budget",
      "kubernetes.resources",
      (value: Value) => {
        delete value.disruptionBudget;
      }
    ],
    [
      "Recreate strategy",
      "kubernetes.rollout_strategy",
      (value: Value) => {
        value.strategy = "Recreate";
      }
    ],
    [
      "maxUnavailable over one",
      "kubernetes.rollout_strategy",
      (value: Value) => {
        value.maxUnavailable = 2;
      }
    ],
    [
      "missing progress deadline",
      "kubernetes.rollout_strategy",
      (value: Value) => {
        delete value.progressDeadlineSeconds;
      }
    ]
  ])("fails pre-deployment evidence for %s with source location", (_case, type, mutate) => {
    const value = copy(healthyPre);
    mutate(value);
    const failures = evaluate(type, "pre_deployment", value).filter(
      (item) => item.status === "failed"
    );
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure.observed).toEqual(
        expect.objectContaining({ document: 0, path: expect.stringMatching(/^\$/) })
      );
    }
  });

  it.each([
    [
      "generation mismatch",
      "kubernetes.rollout_status",
      (value: Value) => {
        (value.rollout as Value).generationObserved = false;
      }
    ],
    [
      "progressing false",
      "kubernetes.rollout_status",
      (value: Value) => {
        entry(value.rollout as Value, "conditions").status = "False";
      }
    ],
    [
      "available false",
      "kubernetes.rollout_status",
      (value: Value) => {
        entry(value.rollout as Value, "conditions", 1).status = "False";
      }
    ],
    [
      "updated replica mismatch",
      "kubernetes.rollout_status",
      (value: Value) => {
        ((value.rollout as Value).replicas as Value).updated = 2;
      }
    ],
    [
      "available replica mismatch",
      "kubernetes.rollout_status",
      (value: Value) => {
        ((value.rollout as Value).replicas as Value).available = 2;
      }
    ],
    [
      "rollout timeout",
      "kubernetes.rollout_status",
      (value: Value) => {
        (value.rollout as Value).durationMs = 700000;
      }
    ],
    [
      "digest mismatch",
      "kubernetes.image_identity",
      (value: Value) => {
        entry(value, "pods").imageDigest =
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      }
    ],
    [
      "restart increase",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").restartIncrease = 1;
      }
    ],
    [
      "CrashLoopBackOff",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").waitingReasons = ["CrashLoopBackOff"];
      }
    ],
    [
      "ImagePullBackOff",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").waitingReasons = ["ImagePullBackOff"];
      }
    ],
    [
      "ErrImagePull",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").waitingReasons = ["ErrImagePull"];
      }
    ],
    [
      "config error",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").waitingReasons = ["CreateContainerConfigError"];
      }
    ],
    [
      "OOMKilled",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").terminationReasons = ["OOMKilled"];
      }
    ],
    [
      "unhealthy probes",
      "kubernetes.pod_health",
      (value: Value) => {
        entry(value, "pods").probesHealthy = false;
      }
    ],
    [
      "eviction",
      "kubernetes.events",
      (value: Value) => {
        value.warningEvents = [{ reason: "Evicted" }];
      }
    ],
    [
      "failed scheduling",
      "kubernetes.events",
      (value: Value) => {
        value.warningEvents = [{ reason: "FailedScheduling" }];
      }
    ],
    [
      "mount failure",
      "kubernetes.events",
      (value: Value) => {
        value.warningEvents = [{ reason: "FailedMount" }];
      }
    ],
    [
      "warning event",
      "kubernetes.events",
      (value: Value) => {
        value.warningEvents = [{ reason: "BackOff" }];
      }
    ]
  ])("detects post-deployment %s", (_case, type, mutate) => {
    const value = copy(healthyPost);
    mutate(value);
    expect(evaluate(type, "post_deployment", value).some((item) => item.status === "failed")).toBe(
      true
    );
  });
});
