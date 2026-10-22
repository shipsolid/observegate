import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";
import { parsePolicy } from "../src/index.js";
async function policy(query: unknown) {
  const input = parse(await readFile("fixtures/configs/minimal-valid.yml", "utf8")) as Record<
    string,
    unknown
  >;
  input.gates = {
    pre_deployment: [],
    post_deployment: [
      {
        id: "trace",
        name: "Trace",
        type: "telemetry.presence",
        source: { provider: "traces", ...(query === undefined ? {} : { query }) },
        assertions: {}
      }
    ]
  };
  return stringify(input);
}
describe("supported trace query policy contract", () => {
  it("rejects string TraceQL instead of replacing it with another query", async () => {
    const input = await policy('{ resource.service.name = "checkout" }');
    expect(() => parsePolicy(input)).toThrow(/TraceQL/iu);
  });
  it.each([undefined, { "resource.service.name": "checkout" }])(
    "supports canonical defaults and identity selectors %j",
    async (query) => {
      expect(parsePolicy(await policy(query)).gates.post_deployment).toHaveLength(1);
    }
  );
});
