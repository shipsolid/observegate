import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { RawPolicy } from "../src/index.js";
import { expandString, expandValue, interpolatePolicy, parsePolicy } from "../src/index.js";

let policy: RawPolicy;

beforeAll(async () => {
  policy = parsePolicy(await readFile(resolve("fixtures/configs/minimal-valid.yml"), "utf8"));
});

describe("interpolatePolicy", () => {
  it("expands canonical identity and selects the target from TARGET_ID", () => {
    const input: RawPolicy = {
      ...policy,
      execution: { ...policy.execution, active_target: "${TARGET_ID}" },
      identity: {
        ...policy.identity,
        canonical: { ...policy.identity.canonical, service_name: "${SERVICE_NAME}" }
      }
    };

    const result = interpolatePolicy(input, {
      phase: "pre_deployment",
      environment: { TARGET_ID: "test", SERVICE_NAME: "checkout" }
    });

    expect(result.execution.active_target).toBe("test");
    expect(result.identity.canonical.service_name).toBe("checkout");
  });

  it("does not require variables in inactive targets or the unselected phase", () => {
    const input = structuredClone(policy);
    input.targets.definitions.inactive = {
      runtime: { type: "generic", provider: "evidence", marker: "${INACTIVE_MARKER}" }
    };
    input.gates.post_deployment.push({
      id: "post.only",
      name: "Post only",
      type: "metric.threshold",
      assertions: { expected: "${POST_ONLY}" }
    });

    const result = interpolatePolicy(input, {
      phase: "pre_deployment",
      environment: {}
    });

    expect(Object.keys(result.targets.definitions)).toEqual(["test"]);
    expect(result.gates.post_deployment).toEqual([]);
  });

  it("uses a target override without requiring active-target interpolation", () => {
    const input = structuredClone(policy);
    input.execution.active_target = "${TARGET_ID}";

    const result = interpolatePolicy(input, {
      phase: "pre_deployment",
      targetOverride: "test",
      environment: {}
    });

    expect(result.execution.active_target).toBe("test");
  });

  it("reports a missing selected variable by name without exposing values", () => {
    const input = structuredClone(policy);
    input.identity.canonical.service_name = "${SERVICE_NAME}";

    expect(() =>
      interpolatePolicy(input, {
        phase: "pre_deployment",
        environment: { UNRELATED_SECRET: "do-not-print" }
      })
    ).toThrowError(
      expect.objectContaining({
        code: "CONFIG_SCHEMA",
        safeMessage: "Missing required environment variable: SERVICE_NAME"
      })
    );
  });

  it("does not mutate the parsed policy", () => {
    const input = structuredClone(policy);
    input.identity.canonical.service_name = "${SERVICE_NAME}";
    const before = structuredClone(input);

    interpolatePolicy(input, {
      phase: "pre_deployment",
      environment: { SERVICE_NAME: "checkout" }
    });

    expect(input).toEqual(before);
  });
});

describe("expandString", () => {
  it("expands only standalone uppercase environment substitutions", () => {
    const unsupported = [
      "${OUTER_${INNER}}",
      "$(COMMAND)",
      "${{ github.sha }}",
      "${VALUE:-default}",
      "\\${ESCAPED}"
    ];

    expect(unsupported.map((value) => expandString(value, {}))).toEqual(unsupported);
    expect(expandString("service=${SERVICE_NAME}", { SERVICE_NAME: "checkout" })).toBe(
      "service=checkout"
    );
  });

  it("expands multiple independent variables without treating prior replacements as nesting", () => {
    expect(
      expandString("${ENVIRONMENT}/${SERVICE_NAME}/${RELEASE_ID}", {
        ENVIRONMENT: "prod",
        SERVICE_NAME: "checkout",
        RELEASE_ID: "2026.10.7"
      })
    ).toBe("prod/checkout/2026.10.7");
    expect(expandString("${OUTER_${INNER}} and ${VALID}", { VALID: "expanded" })).toBe(
      "${OUTER_${INNER}} and expanded"
    );
    expect(expandString("${VALUE}}", { VALUE: "must-not-expand" })).toBe("${VALUE}}");
  });

  it("recursively expands objects and arrays while preserving missing values when requested", () => {
    const input = {
      service: "${SERVICE_NAME}",
      nested: ["${ENVIRONMENT}", 3, null, { release: "${RELEASE_ID}" }],
      missing: "${OPTIONAL}"
    };

    expect(
      expandValue(
        input,
        { SERVICE_NAME: "checkout", ENVIRONMENT: "prod", RELEASE_ID: "2026.10.7" },
        "preserve"
      )
    ).toEqual({
      service: "checkout",
      nested: ["prod", 3, null, { release: "2026.10.7" }],
      missing: "${OPTIONAL}"
    });
    expect(input.service).toBe("${SERVICE_NAME}");
  });

  it.each([undefined, ""])("rejects a required variable with value %s", (value) => {
    expect(() => expandString("${REQUIRED}", { REQUIRED: value })).toThrowError(
      expect.objectContaining({
        code: "CONFIG_SCHEMA",
        safeMessage: "Missing required environment variable: REQUIRED",
        retryable: false
      })
    );
  });
});
