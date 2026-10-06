import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GateError } from "@observability-gate/core";
import { loadPolicy, parsePolicy } from "../src/index.js";

const fixtures = resolve("fixtures/configs");

async function fixture(name: string): Promise<string> {
  return readFile(join(fixtures, name), "utf8");
}

function expectCode(operation: () => unknown, code: string): void {
  expect(operation).toThrowError(
    expect.objectContaining<Partial<GateError>>({
      code
    })
  );
}

describe("parsePolicy", () => {
  it("parses the minimal policy", async () => {
    const policy = parsePolicy(await fixture("minimal-valid.yml"));

    expect(policy.metadata.name).toBe("minimal");
    expect(policy.gates.pre_deployment).toEqual([]);
  });

  it("parses the exhaustive reference policy without modification", async () => {
    const reference = await readFile(resolve("examples/observability-gate.yml"), "utf8");

    const policy = parsePolicy(reference);

    expect(policy.gates.pre_deployment).toHaveLength(39);
    expect(policy.gates.post_deployment).toHaveLength(47);
  });

  it("rejects duplicate YAML keys as syntax errors", async () => {
    const text = await fixture("duplicate-key.yml");

    expectCode(() => parsePolicy(text), "CONFIG_SYNTAX");
  });

  it("rejects YAML aliases and merge keys", async () => {
    const text = await fixture("alias.yml");

    expectCode(() => parsePolicy(text), "SECURITY_POLICY");
  });

  it("rejects unknown top-level fields", async () => {
    const text = await fixture("unknown-field.yml");

    expectCode(() => parsePolicy(text), "CONFIG_SCHEMA");
  });

  it.each(["version", "schema_version"])("rejects the top-level %s field", async (field) => {
    const valid = await fixture("minimal-valid.yml");

    expectCode(() => parsePolicy(`${field}: 1\n${valid}`), "CONFIG_SCHEMA");
  });

  it("requires both execution phases", async () => {
    const valid = await fixture("minimal-valid.yml");
    const withoutPost = valid.replace(
      / {4}post_deployment:\n {6}timeout: 1m\n {6}concurrency: 1\n/,
      ""
    );

    expectCode(() => parsePolicy(withoutPost), "CONFIG_SCHEMA");
  });
});

describe("loadPolicy", () => {
  it("loads a regular policy inside the workspace", async () => {
    const policy = await loadPolicy(join(fixtures, "minimal-valid.yml"), process.cwd());

    expect(policy.metadata.name).toBe("minimal");
  });

  it("rejects a symlink that escapes the workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "observegate-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "observegate-outside-"));
    const outsidePolicy = join(outside, "policy.yml");
    const link = join(workspace, "policy.yml");
    await writeFile(outsidePolicy, await fixture("minimal-valid.yml"), "utf8");
    await symlink(outsidePolicy, link);

    await expect(loadPolicy(link, workspace)).rejects.toMatchObject({
      code: "SECURITY_POLICY"
    });
  });
});
