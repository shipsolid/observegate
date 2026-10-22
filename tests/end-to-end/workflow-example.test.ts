import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAllDocuments } from "yaml";
import { runCli } from "../../packages/cli/src/main.js";
import { type KubernetesReadClient } from "../../packages/providers/src/index.js";
import { describe, expect, it } from "vitest";
import { CompactDeploymentVerifier } from "../../packages/providers/src/index.js";
import { parsePolicy, parseYaml } from "../../packages/config/src/index.js";
import {
  produceDeploymentEvidence,
  verifyDeploymentEvidence
} from "../../examples/deployment-evidence-producer.mjs";

const now = Date.parse("2026-10-22T08:00:00Z");
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = {
  ...pair.publicKey.export({ format: "jwk" }),
  kid: "release-key",
  use: "sig",
  alg: "RS256"
};
const options = {
  privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  publicJwks: { keys: [key] },
  kid: "release-key",
  issuer: "https://releases.example.test",
  audience: "observegate-example",
  subject: "repo:shipsolid/observegate:environment:production",
  target: "aks-checkout",
  deploymentId: "run-123",
  commit: "a".repeat(40),
  releaseId: "release-v2",
  artifactDigest: `sha256:${"b".repeat(64)}`,
  previousReleaseId: "release-v1",
  deployedAt: new Date(now - 30_000).toISOString(),
  workflowIdentity: "shipsolid/observegate/.github/workflows/deploy.yml@refs/heads/main",
  now
};
const expected = {
  target: options.target,
  commit: options.commit,
  releaseId: options.releaseId,
  artifactDigest: options.artifactDigest
};
function verifier() {
  return new CompactDeploymentVerifier({
    trustedIssuer: options.issuer,
    audience: options.audience,
    expectedWorkflowIdentity: options.workflowIdentity,
    keyResolver: async () => key,
    clock: () => now
  });
}

describe("reproducible deployment workflow example", () => {
  it("produces compact asymmetric evidence accepted by the real verifier", async () => {
    const compact = produceDeploymentEvidence(options);
    await expect(verifier().verify(compact, expected)).resolves.toMatchObject({
      deploymentId: options.deploymentId,
      previousReleaseId: "release-v1",
      workflowIdentity: options.workflowIdentity
    });
    await expect(
      verifyDeploymentEvidence(compact, verifier(), expected, options.deploymentId)
    ).resolves.toMatchObject({ target: options.target });
  });
  it("rejects tampering, wrong digest, wrong deployment and another signing key", async () => {
    const compact = produceDeploymentEvidence(options);
    const [header, body, signature] = compact.split(".");
    const changed = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString()),
        deploymentId: "other"
      })
    ).toString("base64url");
    await expect(
      verifier().verify(`${header}.${changed}.${signature}`, expected)
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    await expect(
      verifier().verify(compact, { ...expected, artifactDigest: `sha256:${"c".repeat(64)}` })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    await expect(
      verifyDeploymentEvidence(compact, verifier(), expected, "other-run")
    ).rejects.toThrow(/deployment/i);
    const unrelated = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      produceDeploymentEvidence({
        ...options,
        publicJwks: {
          keys: [{ ...unrelated.publicKey.export({ format: "jwk" }), kid: "release-key" }]
        }
      })
    ).toThrow(/key/i);
  });
  it.each(["$(touch /tmp/observegate-injected)", "bad\nrelease", "release,extra=value"])(
    "rejects unsafe release identifiers %s",
    (releaseId) => {
      expect(() => produceDeploymentEvidence({ ...options, releaseId })).toThrow(/release/i);
    }
  );
  it("rejects invalid digest and pre-deployment attestation timestamps", () => {
    expect(() => produceDeploymentEvidence({ ...options, artifactDigest: "latest" })).toThrow(
      /digest/i
    );
    expect(() =>
      produceDeploymentEvidence({ ...options, deployedAt: new Date(now + 30_000).toISOString() })
    ).toThrow(/deployment/i);
  });
  it("contains a policy accepted by the public parser", async () => {
    expect(parsePolicy(await readFile("examples/workflow-policy.yml", "utf8")).metadata.name).toBe(
      "checkout-workflow-example"
    );
  });
  it("keeps dispatch input out of shell source and retains reports after failure", async () => {
    const workflow = parseYaml(await readFile("examples/workflows/pre-and-post.yml", "utf8")) as {
      jobs: Record<
        string,
        { steps: { name?: string; run?: string; if?: string; uses?: string }[] }
      >;
    };
    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
    for (const step of steps) if (step.run) expect(step.run).not.toMatch(/\$\{\{\s*inputs\./);
    expect(steps.filter((step) => step.uses === "./")).toHaveLength(2);
    for (const phase of ["pre-deployment", "post-deployment"])
      expect(
        workflow.jobs[phase]?.steps.find((step) => step.name === "Upload gate reports")?.if
      ).toBe("always()");
  });
});

let helmAvailable = false;
try {
  execFileSync("helm", ["version", "--short"], { stdio: "ignore" });
  helmAvailable = true;
} catch {
  /* optional executable */
}

describe.skipIf(!helmAvailable)(
  "Helm example through provider acquisition and gate evaluation",
  () => {
    it("passes rendered pre-gates and verifies transferred signed evidence with controller identity", async () => {
      const root = await mkdtemp(join(tmpdir(), "observegate-workflow-"));
      const timestamp = Date.now();
      const deployedAt = new Date(timestamp - 30_000).toISOString();
      const environment = {
        RELEASE_ID: options.releaseId,
        IMAGE_DIGEST: options.artifactDigest,
        DEPLOYMENT_ID: options.deploymentId,
        COMMIT_SHA: options.commit,
        DEPLOYED_AT: deployedAt,
        EVIDENCE_ISSUER: options.issuer,
        EXPECTED_WORKFLOW_IDENTITY: options.workflowIdentity
      };
      try {
        const renderOutput = await open(join(root, "rendered.yaml"), "w");
        try {
          execFileSync(
            "helm",
            [
              "template",
              "checkout",
              "examples/helm/checkout",
              "--namespace",
              "observegate-example",
              "--set-string",
              "image.repository=ghcr.io/example/checkout",
              "--set-string",
              `image.digest=${options.artifactDigest}`,
              "--set-string",
              `releaseId=${options.releaseId}`
            ],
            { stdio: ["ignore", renderOutput.fd, "inherit"] }
          );
        } finally {
          await renderOutput.close();
        }
        const rendered = await readFile(join(root, "rendered.yaml"), "utf8");
        await mkdir(join(root, "deploy"));
        await mkdir(join(root, "deployment-evidence"));
        await mkdir(join(root, ".observegate-trust"));
        await writeFile(join(root, "deploy/rendered.yaml"), rendered);
        await writeFile(
          join(root, ".observegate-trust/jwks.json"),
          JSON.stringify({ keys: [key] })
        );
        await writeFile(
          join(root, "deployment-evidence/release.jws"),
          produceDeploymentEvidence({ ...options, now: timestamp, deployedAt })
        );
        const workload = parseAllDocuments(rendered)
          .map((document) => document.toJS())
          .find((value) => value.kind === "Deployment");
        workload.metadata.uid = "workload";
        workload.metadata.generation = 1;
        workload.status = {
          observedGeneration: 1,
          replicas: 2,
          updatedReplicas: 2,
          readyReplicas: 2,
          availableReplicas: 2,
          unavailableReplicas: 0,
          conditions: [
            { type: "Progressing", status: "True" },
            { type: "Available", status: "True" }
          ]
        };
        let workloadReads = 0;
        const client: KubernetesReadClient = {
          readWorkload: async () => {
            workloadReads++;
            return workload;
          },
          listReplicaSets: async () => ({ items: [] }),
          listEvents: async () => ({ items: [] }),
          listPods: async () => ({
            items: [0, 1].map((index) => ({
              metadata: {
                name: `checkout-${index}`,
                uid: `pod-${index}`,
                labels: workload.metadata.labels,
                ownerReferences: [{ uid: "workload", controller: true }]
              },
              status: {
                phase: "Running",
                conditions: [{ type: "Ready", status: "True" }],
                containerStatuses: [
                  {
                    name: "checkout",
                    imageID: `ghcr.io/example/checkout@${options.artifactDigest}`,
                    restartCount: 0
                  }
                ]
              }
            }))
          })
        };
        await writeFile(join(root, "policy.yml"), await readFile("examples/workflow-policy.yml"));
        for (const phase of ["pre_deployment", "post_deployment"] as const) {
          let stdout = "";
          const code = await runCli(
            [
              "run",
              "--config",
              "policy.yml",
              "--phase",
              phase,
              "--output-directory",
              join(root, "reports", phase),
              "--json"
            ],
            {
              workspaceRoot: root,
              environment,
              providerOptions: { runtimeClients: { kubernetes: client }, clock: () => timestamp },
              output: {
                stdout: (value) => {
                  stdout += value;
                },
                stderr: () => undefined
              }
            }
          );
          expect(code, stdout).toBe(0);
          expect(JSON.parse(stdout).decision).toBe("pass");
        }
        expect(workloadReads).toBe(1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
);

describe("user-owned evidence producer CLI", () => {
  it("prepares embedded read-only credentials, rejects exec auth and signs after completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "observegate-producer-"));
    const script = fileURLToPath(
      new URL("../../examples/deployment-evidence-producer.mjs", import.meta.url)
    );
    const now = Date.now();
    const kubeconfig = {
      apiVersion: "v1",
      kind: "Config",
      "current-context": "example",
      contexts: [{ name: "example", context: { cluster: "example", user: "reader" } }],
      clusters: [{ name: "example", cluster: { server: "https://cluster.example.test" } }],
      users: [{ name: "reader", user: { token: "test-read-token" } }]
    };
    const env = {
      ...process.env,
      RELEASE_ID: options.releaseId,
      IMAGE_DIGEST: options.artifactDigest,
      IMAGE_REPOSITORY: "ghcr.io/example/checkout",
      RUNNER_TEMP: root,
      GITHUB_ENV: join(root, "environment"),
      PUBLIC_JWKS_JSON: JSON.stringify({ keys: [key] }),
      KUBECONFIG_CONTENT: JSON.stringify(kubeconfig),
      SIGNING_PRIVATE_KEY_PEM: options.privateKeyPem,
      SIGNING_KEY_ID: options.kid,
      PUBLIC_JWKS_FILE: join(root, ".observegate-trust/jwks.json"),
      EVIDENCE_OUTPUT: join(root, "release.jws"),
      EVIDENCE_SUBJECT: options.subject,
      EVIDENCE_ISSUER: options.issuer,
      TARGET_ID: options.target,
      DEPLOYMENT_ID: options.deploymentId,
      COMMIT_SHA: options.commit,
      DEPLOYED_AT: new Date(now - 1000).toISOString(),
      WORKFLOW_IDENTITY: options.workflowIdentity,
      EXPECTED_WORKFLOW_IDENTITY: options.workflowIdentity
    };
    const diagnostics = await open(join(root, "diagnostics"), "w");
    try {
      const run = (command: string, environment = env) =>
        execFileSync(process.execPath, [script, command], {
          cwd: root,
          env: environment,
          stdio: ["ignore", diagnostics.fd, diagnostics.fd]
        });
      run("prepare-readonly");
      expect(await readFile(join(root, "environment"), "utf8")).toContain(
        `KUBECONFIG=${root}/observegate-readonly-kubeconfig`
      );
      expect(await readFile(join(root, "observegate-readonly-kubeconfig"), "utf8")).toBe(
        env.KUBECONFIG_CONTENT
      );
      expect(() =>
        run("prepare-readonly", {
          ...env,
          KUBECONFIG_CONTENT: JSON.stringify({
            ...kubeconfig,
            users: [{ name: "reader", user: { exec: { command: "az" } } }]
          })
        })
      ).toThrow();
      run("sign");
      const compact = await readFile(join(root, "release.jws"), "utf8");
      const verify = new CompactDeploymentVerifier({
        trustedIssuer: options.issuer,
        audience: options.audience,
        expectedWorkflowIdentity: options.workflowIdentity,
        keyResolver: async () => key
      });
      await expect(
        verify.verify(compact, { ...expected, deploymentId: options.deploymentId })
      ).resolves.toMatchObject({ releaseId: options.releaseId });
    } finally {
      await diagnostics.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
