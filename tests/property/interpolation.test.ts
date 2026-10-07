import { expandString } from "@observability-gate/config";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

describe("interpolation properties", () => {
  it("expands only standalone uppercase environment variables", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/u),
        fc.string({ maxLength: 100 }),
        (name, value) => {
          const replacement = value.length === 0 ? "defined" : value;
          expect(expandString(`before-\${${name}}-after`, { [name]: replacement })).toBe(
            `before-${replacement}-after`
          );
          expect(expandString(`$(COMMAND)-\${${name}:-default}-\${{ github.sha }}`, {})).toBe(
            `$(COMMAND)-\${${name}:-default}-\${{ github.sha }}`
          );
        }
      ),
      { numRuns: 250 }
    );
  });

  it("never evaluates command or expression syntax", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (payload) => {
        for (const candidate of [`$(${payload})`, `\${{ ${payload} }}`, `\${VALUE:-${payload}}`]) {
          expect(expandString(candidate, { VALUE: "replacement" })).toBe(candidate);
        }
      })
    );
  });
});
