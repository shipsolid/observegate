import { describe, expect, it } from "vitest";
import { inspectCycloneDx } from "../../scripts/verify-sbom.js";

const manifest = { name: "@shipsolid/observegate", version: "1.2.3" };

describe("release SBOM policy", () => {
  it("accepts an artifact SBOM with the expected package identity", () => {
    expect(
      inspectCycloneDx(
        {
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          components: [
            {
              group: "@shipsolid",
              name: "observegate",
              version: "1.2.3",
              purl: "pkg:npm/%40shipsolid%2Fobservegate@1.2.3"
            }
          ]
        },
        manifest
      )
    ).toEqual([]);
  });

  it("rejects the wrong product version and Action-only packages", () => {
    expect(
      inspectCycloneDx(
        {
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          components: [
            { group: "@shipsolid", name: "observegate", version: "1.2.2" },
            { group: "@actions", name: "core", version: "3.0.1" }
          ]
        },
        manifest
      )
    ).toEqual([
      "SBOM does not identify @shipsolid/observegate@1.2.3",
      "SBOM contains Action-only package @actions/core"
    ]);
  });
});
