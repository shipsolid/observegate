import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseIncidentEvidence,
  parseOtlpContract,
  parseSarifEvidence,
  parseSyntheticEvidence
} from "../../src/index.js";

async function fixture(path: string): Promise<Buffer> {
  return readFile(fileURLToPath(new URL(`../../../../fixtures/evidence/${path}`, import.meta.url)));
}

describe("file evidence contracts", () => {
  it("rejects policy-specific sensitive fields in captured signals", async () => {
    const content = JSON.parse((await fixture("otlp/contract.json")).toString("utf8"));
    content.logs[0].attributes["customer.email"] = "private@example.test";
    expect(() =>
      parseOtlpContract(
        Buffer.from(JSON.stringify(content)),
        { commit: "abc123", workflow: "observegate-ci" },
        { forbiddenFields: ["customer.email"] }
      )
    ).toThrowError(expect.objectContaining({ code: "EVIDENCE_INVALID" }));
  });
  it("extracts only configured SARIF instrumentation rule families and locations", async () => {
    const evidence = parseSarifEvidence(await fixture("sarif/instrumentation.sarif"), {
      acceptedRulePrefixes: ["OTEL"]
    });
    expect(evidence).toEqual({
      findings: [
        {
          ruleId: "OTEL001",
          level: "error",
          message: "service.name is missing",
          location: { path: "src/app.ts", line: 12 }
        }
      ]
    });
  });

  it("validates OTLP signals, canonical resources, correlation, routes, and provenance", async () => {
    const evidence = parseOtlpContract(await fixture("otlp/contract.json"), {
      commit: "abc123",
      workflow: "observegate-ci"
    });
    expect(evidence).toMatchObject({
      resource: {
        serviceName: "checkout",
        serviceNamespace: "shop",
        serviceVersion: "2026.10.6",
        deploymentEnvironment: "production"
      },
      metricCount: 1,
      logCount: 1,
      traceCount: 1,
      correlatedLogCount: 1,
      errorSpanCount: 1,
      routes: ["/orders/{id}"]
    });

    const unsafe = JSON.parse((await fixture("otlp/contract.json")).toString("utf8")) as Record<
      string,
      unknown
    >;
    unsafe.metrics = [{ name: "bad", attributes: { request_id: "unbounded" } }];
    expect(() =>
      parseOtlpContract(Buffer.from(JSON.stringify(unsafe)), {
        commit: "abc123",
        workflow: "observegate-ci"
      })
    ).toThrowError(expect.objectContaining({ code: "EVIDENCE_INVALID" }));
  });

  it("parses product JSON and JUnit synthetic results without XML entities", async () => {
    expect(parseSyntheticEvidence(await fixture("synthetic/results.json"))).toMatchObject({
      tests: [{ name: "checkout ready", status: "passed", observedRelease: "2026.10.6" }]
    });
    expect(parseSyntheticEvidence(await fixture("synthetic/results.xml"))).toMatchObject({
      tests: [
        { name: "checkout ready", status: "passed", durationMs: 125 },
        { name: "checkout purchase", status: "failed", durationMs: 500 }
      ]
    });
    expect(() =>
      parseSyntheticEvidence(
        Buffer.from('<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><x>&y;</x>')
      )
    ).toThrowError(expect.objectContaining({ code: "SECURITY_POLICY" }));
  });

  it("normalizes incident service, environment, severity, state, and update time", async () => {
    expect(parseIncidentEvidence(await fixture("incidents/incidents.json"))).toEqual({
      incidents: [
        {
          id: "inc-123",
          service: "checkout",
          environment: "production",
          severity: "critical",
          state: "active",
          updatedAt: "2026-10-06T08:00:00.000Z"
        }
      ]
    });
  });
});

describe("strict synthetic evidence", () => {
  it("treats JUnit errors as failed and ignores comment and CDATA markup", () => {
    const xml = `<testsuite><!-- <testcase name="fake" time="1"/> --><testcase name='real &amp; named' time='0.2'><error><![CDATA[<testcase name="fake2" time="1"/>]]></error></testcase></testsuite>`;
    expect(parseSyntheticEvidence(Buffer.from(xml))).toEqual({
      tests: [{ name: "real & named", status: "failed", durationMs: 200 }]
    });
  });
  it.each([
    '<testsuite><testcase name="ok" time="1"/></wrong>',
    '<testsuite><!-- <testcase name="fake" time="1"/> --></testsuite>',
    '<testsuite><testcase name="same" time="1"/><testcase name="same" time="1"/></testsuite>',
    JSON.stringify({ tests: [{ name: "bad", status: "passed", durationMs: -1 }] }),
    JSON.stringify({ tests: [{ name: "bad", status: "passed", durationMs: 1, timestamp: "bad" }] }),
    JSON.stringify({
      tests: [
        { name: "bad", status: "passed", durationMs: 1 },
        { name: "bad", status: "failed", durationMs: 1 }
      ]
    })
  ])("rejects malformed or ambiguous evidence %s", (content) => {
    expect(() => parseSyntheticEvidence(Buffer.from(content))).toThrowError(
      expect.objectContaining({ code: "EVIDENCE_INVALID" })
    );
  });
});
