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

function evaluate(type: string, phase: Phase, value: Value, assertions: Value = {}) {
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
    .require(type, phase, { assertions })
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

describe("Kubernetes controller and policy contracts", () => {
  it.each(["StatefulSet", "DaemonSet"])(
    "accepts healthy %s without Deployment conditions",
    (workloadKind) => {
      const value = copy(healthyPost);
      value.workloadKind = workloadKind;
      (value.rollout as Value).conditions = [];
      (value.rollout as Value).currentRevision = "v2";
      (value.rollout as Value).updateRevision = "v2";
      expect(
        evaluate("kubernetes.rollout_status", "post_deployment", value).every(
          (r) => r.status === "passed"
        )
      ).toBe(true);
    }
  );
  it("rejects a StatefulSet whose controller revisions differ", () => {
    const value = copy(healthyPost);
    value.workloadKind = "StatefulSet";
    Object.assign(value.rollout as Value, { currentRevision: "v1", updateRevision: "v2" });
    expect(
      evaluate("kubernetes.rollout_status", "post_deployment", value).some(
        (r) => r.status === "failed"
      )
    ).toBe(true);
  });
  it.each([{ minAvailable: 0 }, { maxUnavailable: "100%" }, { minAvailable: 4 }])(
    "rejects ineffective disruption protection %j",
    (disruptionBudget) => {
      expect(
        evaluate("kubernetes.resources", "pre_deployment", {
          ...healthyPre,
          disruptionBudget
        }).some((r) => r.status === "failed")
      ).toBe(true);
    }
  );
  it("applies configured resource and readiness thresholds", () => {
    expect(
      evaluate("kubernetes.resources", "pre_deployment", healthyPre, {
        production_minimum_replicas: 4
      }).some((r) => r.status === "failed")
    ).toBe(true);
    expect(
      evaluate("kubernetes.probes", "pre_deployment", healthyPre, {
        timeout_seconds: { maximum: 1 }
      }).some((r) => r.status === "failed")
    ).toBe(true);
    expect(
      evaluate(
        "kubernetes.pod_health",
        "post_deployment",
        { ...healthyPost, pods: [{ ready: true, restartIncrease: 1, probesHealthy: true }] },
        { restart_increase: { less_than_or_equal: 2 } }
      ).every((r) => r.status === "passed")
    ).toBe(true);
  });
  it.each(["StatefulSet", "DaemonSet"])(
    "evaluates %s strategy without Deployment-only deadlines",
    (workloadKind) => {
      const value = { ...healthyPre, workloadKind };
      delete value.progressDeadlineSeconds;
      expect(
        evaluate("kubernetes.rollout_strategy", "pre_deployment", value).every(
          (r) => r.status === "passed"
        )
      ).toBe(true);
    }
  );
});

describe("Kubernetes configurable assertions", () => {
  it.each([
    [
      "kubernetes.manifest",
      { forbid_privileged: false },
      { containerSecurityContext: { privileged: true, readOnlyRootFilesystem: true } }
    ],
    [
      "kubernetes.manifest",
      { read_only_root_filesystem: false },
      { containerSecurityContext: { readOnlyRootFilesystem: false } }
    ],
    ["kubernetes.manifest", { namespace_is_explicit: false }, { namespaceExplicit: false }],
    ["kubernetes.probes", { readiness_probe_required: false }, { readinessProbe: undefined }],
    ["kubernetes.probes", { liveness_probe_required: false }, { livenessProbe: undefined }],
    [
      "kubernetes.probes",
      { failure_threshold: { minimum: 4 } },
      {
        readinessProbe: { failureThreshold: 4 },
        livenessProbe: { failureThreshold: 4 },
        startupProbe: { failureThreshold: 4 }
      }
    ],
    ["kubernetes.resources", { production_minimum_replicas: 1 }, { replicas: 1 }],
    [
      "kubernetes.resources",
      { disruption_budget_for_multiple_replicas: false },
      { disruptionBudget: undefined }
    ],
    [
      "kubernetes.resources",
      { request_must_not_exceed_limit: false },
      { resources: { requests: { cpu: "5", memory: "1Gi" }, limits: { cpu: "1", memory: "1Mi" } } }
    ],
    ["kubernetes.rollout_strategy", { allowed_strategies: ["Recreate"] }, { strategy: "Recreate" }],
    [
      "kubernetes.rollout_strategy",
      { max_unavailable: { less_than_or_equal: 2 } },
      { maxUnavailable: 2 }
    ],
    [
      "kubernetes.rollout_strategy",
      { progress_deadline_required: false },
      { progressDeadlineSeconds: undefined }
    ],
    [
      "kubernetes.rollout_strategy",
      { minimum_ready_seconds: { greater_than_or_equal: 0 } },
      { minimumReadySeconds: 0 }
    ]
  ] as [string, Value, Value][])("applies %s policy %j", (type, assertions, mutation) => {
    expect(
      evaluate(type, "pre_deployment", { ...copy(healthyPre), ...mutation }, assertions).every(
        (r) => r.status === "passed"
      )
    ).toBe(true);
  });
  it.each([
    ["kubernetes.probes", { startup_probe_required: true }, { startupProbe: undefined }],
    ["kubernetes.probes", { failure_threshold: { minimum: 4 } }, {}],
    ["kubernetes.resources", { requests_required: ["ephemeral-storage"] }, {}],
    ["kubernetes.resources", { limits_required: ["cpu", "memory", "ephemeral-storage"] }, {}],
    ["kubernetes.rollout_strategy", { allowed_strategies: ["OnDelete"] }, {}],
    ["kubernetes.rollout_strategy", { minimum_ready_seconds: { greater_than_or_equal: 20 } }, {}],
    ["kubernetes.resources", { production_minimum_replicas: 2 }, { workloadKind: "DaemonSet" }],
    ["kubernetes.rollout_strategy", {}, { workloadKind: "DaemonSet", maxUnavailable: "25%" }],
    ["kubernetes.rollout_strategy", {}, { workloadKind: "StatefulSet", partition: 1 }]
  ] as [string, Value, Value][])(
    "fails %s policy %j on violating evidence",
    (type, assertions, mutation) => {
      expect(
        evaluate(type, "pre_deployment", { ...copy(healthyPre), ...mutation }, assertions).some(
          (r) => r.status === "failed"
        )
      ).toBe(true);
    }
  );
  it("uses configured ready percentages and forbidden pod reasons", () => {
    const value = {
      ...healthyPost,
      pods: [
        {
          ready: true,
          probesHealthy: true,
          restartIncrease: 0,
          waitingReasons: ["CustomWait"],
          terminationReasons: []
        },
        {
          ready: false,
          probesHealthy: false,
          restartIncrease: 0,
          waitingReasons: [],
          terminationReasons: []
        }
      ]
    };
    expect(
      evaluate("kubernetes.pod_health", "post_deployment", value, {
        ready_percent: { greater_than_or_equal: 50 }
      }).every((r) => r.status === "passed")
    ).toBe(true);
    expect(
      evaluate("kubernetes.pod_health", "post_deployment", value, {
        ready_percent: { greater_than_or_equal: 50 },
        forbidden_waiting_reasons: ["CustomWait"]
      }).some((r) => r.status === "failed")
    ).toBe(true);
  });
  it("allows controller assertion toggles and unavailable thresholds", () => {
    const value = copy(healthyPost);
    const rollout = value.rollout as Value;
    rollout.generationObserved = false;
    rollout.conditions = [];
    rollout.replicas = { desired: 3, updated: 2, available: 2, unavailable: 1 };
    expect(
      evaluate("kubernetes.rollout_status", "post_deployment", value, {
        observed_generation_matches: false,
        progressing_condition: false,
        available_condition: false,
        updated_replicas_equal_desired: false,
        available_replicas_equal_desired: false,
        unavailable_replicas: { less_than_or_equal: 1 }
      }).every((r) => r.status === "passed")
    ).toBe(true);
  });
  it("reports the selected container index in manifest findings", () => {
    const findings = evaluate("kubernetes.manifest", "pre_deployment", {
      ...healthyPre,
      containerIndex: 1,
      image: "app:latest"
    });
    expect(findings.find((r) => r.assertion === "digest-pinned image")?.observed).toMatchObject({
      path: "$.spec.template.spec.containers[1].image"
    });
  });
});
