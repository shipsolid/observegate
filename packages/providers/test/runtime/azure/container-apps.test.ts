import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  AzureContainerAppsAdapter,
  parseContainerAppManifest,
  type ContainerAppsReadClient
} from "../../../src/index.js";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(
    await readFile(
      fileURLToPath(
        new URL(
          `../../../../../fixtures/providers/azure/container-apps/${name}.json`,
          import.meta.url
        )
      ),
      "utf8"
    )
  ) as unknown;
}

const request = {
  target: "prod-checkout",
  resourceGroup: "prod-rg",
  appName: "checkout",
  revisionName: "checkout--20261006",
  signal: new AbortController().signal
};

describe("AzureContainerAppsAdapter", () => {
  it("normalizes app, revision, replicas, image, traffic, and activation failures", async () => {
    const revisions = (await fixture("revisions")) as unknown[];
    const client: ContainerAppsReadClient = {
      getApp: vi.fn(async () => fixture("app")),
      listRevisions: vi.fn(async function* () {
        yield revisions[0];
      }),
      listReplicas: vi.fn(async () => fixture("replicas") as Promise<readonly unknown[]>)
    };
    const evidence = await new AzureContainerAppsAdapter(client, () =>
      Date.parse("2026-10-06T08:00:00.000Z")
    ).getSnapshot(request);
    expect(evidence).toMatchObject({
      state: "valid",
      value: {
        provisioningState: "Succeeded",
        revision: {
          name: "checkout--20261006",
          suffix: "20261006",
          provisioningState: "Provisioned",
          runningState: "Running",
          active: true,
          imageDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        },
        replicas: { total: 2, healthy: 1, failed: 1, restarts: 2 },
        traffic: { totalWeight: 100, candidateWeight: 90, unknownRevisionWeight: 10 }
      }
    });
  });

  it("distinguishes missing app/revision and authentication from authorization", async () => {
    for (const [statusCode, code] of [
      [404, "EVIDENCE_INVALID"],
      [401, "AUTHENTICATION"],
      [403, "AUTHORIZATION"]
    ] as const) {
      const client: ContainerAppsReadClient = {
        getApp: vi.fn(async () =>
          Promise.reject(Object.assign(new Error("azure failure"), { statusCode }))
        ),
        listRevisions: vi.fn(),
        listReplicas: vi.fn()
      };
      await expect(
        new AzureContainerAppsAdapter(client).getSnapshot(request)
      ).rejects.toMatchObject({ code });
    }

    const missingRevision: ContainerAppsReadClient = {
      getApp: vi.fn(async () => fixture("app")),
      listRevisions: vi.fn(async function* () {}),
      listReplicas: vi.fn()
    };
    await expect(
      new AzureContainerAppsAdapter(missingRevision).getSnapshot(request)
    ).rejects.toMatchObject({
      code: "EVIDENCE_INVALID"
    });
  });

  it("parses rendered Container Apps configuration", async () => {
    const content = await readFile(
      fileURLToPath(
        new URL("../../../../../fixtures/manifests/container-apps/app.json", import.meta.url)
      ),
      "utf8"
    );
    expect(parseContainerAppManifest(content)).toMatchObject({
      image: expect.stringContaining("@sha256:"),
      revisionMode: "Multiple",
      ingressTransport: "auto",
      minimumReplicas: 2,
      maximumReplicas: 10,
      probes: [{ type: "Readiness" }],
      managedIdentity: "SystemAssigned",
      otelEnvironment: { OTEL_SERVICE_NAME: "checkout" }
    });
  });
});
