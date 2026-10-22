import { mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createEventWriter } from "../src/index.js";

const directories: string[] = [];
async function workspace() {
  const path = await mkdtemp(join(tmpdir(), "observegate-events-"));
  directories.push(path);
  return path;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, {recursive: true, force: true}))); });

describe("local diagnostic events", () => {
  it("writes only safe event fields with private file permissions", async () => {
    const root = await workspace();
    const writer = await createEventWriter({workspaceRoot: root, path: "reports/events.jsonl"});
    writer.write({name: "provider_request_completed", at: new Date().toISOString(), provider: "metrics", durationMs: 12, ...{query: "secret-provider-query", headers: {authorization: "secret-token"}}});
    writer.close();
    const content = await readFile(join(root, "reports/events.jsonl"), "utf8");
    expect(JSON.parse(content)).toMatchObject({name: "provider_request_completed", provider: "metrics", durationMs: 12});
    expect(content).not.toContain("secret");
    expect((await stat(join(root, "reports/events.jsonl"))).mode & 0o777).toBe(0o600);
  });
  it("rejects directory traversal and symlink escapes", async () => {
    const root = await workspace(), outside = await workspace();
    await symlink(outside, join(root, "escape"));
    await expect(createEventWriter({workspaceRoot: root, path: "../escape.jsonl"})).rejects.toMatchObject({code: "SECURITY_POLICY"});
    await expect(createEventWriter({workspaceRoot: root, path: "escape/events.jsonl"})).rejects.toMatchObject({code: "SECURITY_POLICY"});
  });
  it("enforces the event stream size limit without writing a partial event", async () => {
    const root = await workspace();
    const writer = await createEventWriter({workspaceRoot: root, path: "events.jsonl", maximumBytes: 1});
    expect(() => writer.write({name: "decision_completed", at: new Date().toISOString(), decision: "pass"})).toThrow("Diagnostic event stream exceeds its size limit.");
    writer.close();
    expect(await readFile(join(root, "events.jsonl"), "utf8")).toBe("");
  });
});
