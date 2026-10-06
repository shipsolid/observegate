import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { GateError } from "@observability-gate/core";
import { parseDocument, visit } from "yaml";
import { policySchema, type RawPolicy } from "./schema/policy.js";

const MAX_POLICY_BYTES = 2 * 1024 * 1024;

function syntaxError(messages: readonly string[]): GateError {
  return new GateError({
    code: "CONFIG_SYNTAX",
    safeMessage: messages.join("; "),
    retryable: false
  });
}

export function parseYaml(text: string): unknown {
  const document = parseDocument(text, {
    uniqueKeys: true,
    merge: false
  });

  if (document.errors.length > 0) {
    throw syntaxError(document.errors.map((error) => error.message));
  }

  let containsYamlReference = false;
  visit(document, {
    Alias() {
      containsYamlReference = true;
    },
    Node(_key, node) {
      if ("anchor" in node && node.anchor !== undefined) {
        containsYamlReference = true;
      }
    }
  });

  if (containsYamlReference) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "YAML aliases, anchors, and merge keys are not allowed.",
      retryable: false
    });
  }

  return document.toJS({ maxAliasCount: 0 }) as unknown;
}

export function parsePolicy(text: string): RawPolicy {
  const parsed = policySchema.safeParse(parseYaml(text));
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
      .join("; ");
    throw new GateError({
      code: "CONFIG_SCHEMA",
      safeMessage: message,
      retryable: false
    });
  }

  return parsed.data;
}

export async function loadPolicy(path: string, workspace: string): Promise<RawPolicy> {
  let realWorkspace: string;
  let realPolicyPath: string;
  try {
    realWorkspace = await realpath(workspace);
    realPolicyPath = await realpath(isAbsolute(path) ? path : resolve(realWorkspace, path));
  } catch {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: "The policy path or workspace does not exist.",
      retryable: false
    });
  }

  const pathFromWorkspace = relative(realWorkspace, realPolicyPath);
  if (
    pathFromWorkspace === ".." ||
    pathFromWorkspace.startsWith(`..${sep}`) ||
    isAbsolute(pathFromWorkspace)
  ) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "The policy file must resolve inside the workspace.",
      retryable: false
    });
  }

  const policyStat = await stat(realPolicyPath);
  if (!policyStat.isFile()) {
    throw new GateError({
      code: "CONFIG_REFERENCE",
      safeMessage: "The policy path must resolve to a regular file.",
      retryable: false
    });
  }
  if (policyStat.size > MAX_POLICY_BYTES) {
    throw new GateError({
      code: "SECURITY_POLICY",
      safeMessage: "The policy file exceeds the 2 MiB size limit.",
      retryable: false
    });
  }

  return parsePolicy(await readFile(realPolicyPath, "utf8"));
}
