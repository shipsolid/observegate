import { mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYaml } from "@observability-gate/config";
import { SafeEvidenceFileLoader } from "@observability-gate/providers";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

describe("policy and evidence file boundary", () => {
  it("rejects traversal and workspace-escaping symlinks", async () => {
    const workspace = await directory("observegate-security-workspace-");
    const outside = await directory("observegate-security-outside-");
    await writeFile(join(outside, "secret.json"), '{"token":"secret"}');
    await symlink(join(outside, "secret.json"), join(workspace, "linked.json"));
    const loader = new SafeEvidenceFileLoader({ workspaceRoot: workspace });

    await expect(loader.load({ path: "../secret.json", blocking: true })).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
    await expect(loader.load({ path: "linked.json", blocking: true })).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
  });

  it("rejects oversized and future-dated evidence", async () => {
    const workspace = await directory("observegate-security-limits-");
    const path = join(workspace, "evidence.json");
    await writeFile(path, "123456789");
    const now = Date.parse("2026-10-06T00:00:00.000Z");

    await expect(
      new SafeEvidenceFileLoader({ workspaceRoot: workspace, maximumBytes: 8 }).load({
        path: "evidence.json",
        blocking: false
      })
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
    await utimes(path, new Date(now + 60_000), new Date(now + 60_000));
    await expect(
      new SafeEvidenceFileLoader({ workspaceRoot: workspace, clock: () => now }).load({
        path: "evidence.json",
        blocking: false,
        maximumFutureSkewMs: 1_000
      })
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
  });

  it.each([
    "a: 1\na: 2\n",
    "defaults: &defaults\n  timeout: 1s\ngate: *defaults\n",
    "defaults: &defaults\n  timeout: 1s\ngate:\n  <<: *defaults\n"
  ])("rejects malicious YAML constructs", (yaml) => {
    expect(() => parseYaml(yaml)).toThrow();
  });
});
