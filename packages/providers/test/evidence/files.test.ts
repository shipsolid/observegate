import { chmod, mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SafeEvidenceFileLoader } from "../../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "observegate-evidence-"));
  roots.push(root);
  return root;
}

describe("SafeEvidenceFileLoader", () => {
  it("loads bounded regular files with canonical metadata and SHA-256", async () => {
    const root = await workspace();
    await writeFile(join(root, "evidence.json"), '{"ok":true}');
    const loaded = await new SafeEvidenceFileLoader({ workspaceRoot: root }).load({
      path: "evidence.json",
      blocking: true
    });
    expect(loaded).toMatchObject({
      relativePath: "evidence.json",
      mediaType: "application/json",
      size: 11,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    });
    expect(loaded.content.toString("utf8")).toBe('{"ok":true}');
  });

  it("rejects absolute paths, traversal, out-of-workspace symlinks, and non-regular files", async () => {
    const root = await workspace();
    const outside = await workspace();
    await writeFile(join(outside, "secret.json"), "{}");
    await symlink(join(outside, "secret.json"), join(root, "linked.json"));
    await mkdir(join(root, "directory"));
    const loader = new SafeEvidenceFileLoader({ workspaceRoot: root });

    for (const path of [
      join(root, "absolute.json"),
      "../escape.json",
      "linked.json",
      "directory"
    ]) {
      await expect(loader.load({ path, blocking: true })).rejects.toMatchObject({
        code: "SECURITY_POLICY"
      });
    }
  });

  it("rejects world-writable blocking evidence and oversized files", async () => {
    const root = await workspace();
    await writeFile(join(root, "open.json"), "{}");
    await chmod(join(root, "open.json"), 0o666);
    await writeFile(join(root, "large.json"), "123456789");

    await expect(
      new SafeEvidenceFileLoader({ workspaceRoot: root }).load({
        path: "open.json",
        blocking: true
      })
    ).rejects.toMatchObject({ code: "SECURITY_POLICY" });
    await expect(
      new SafeEvidenceFileLoader({ workspaceRoot: root, maximumBytes: 8 }).load({
        path: "large.json",
        blocking: false
      })
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
  });

  it("rejects stale modification times and timestamps beyond future skew", async () => {
    const root = await workspace();
    const path = join(root, "timed.json");
    await writeFile(path, "{}");
    const now = Date.parse("2026-10-06T08:00:00.000Z");
    const loader = new SafeEvidenceFileLoader({ workspaceRoot: root, clock: () => now });

    await utimes(path, new Date(now - 10_000), new Date(now - 10_000));
    await expect(
      loader.load({ path: "timed.json", blocking: true, maximumAgeMs: 1_000 })
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });

    await utimes(path, new Date(now + 10_000), new Date(now + 10_000));
    await expect(
      loader.load({ path: "timed.json", blocking: true, maximumFutureSkewMs: 1_000 })
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALID" });
  });
});
