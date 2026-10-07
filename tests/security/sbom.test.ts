import { describe, expect, it } from "vitest";
import { bundledPackages, deterministicSerial } from "../../scripts/bundle-dependencies.js";
import { finalizeCycloneDx } from "../../scripts/finalize-sbom.js";
import { inspectCycloneDx } from "../../scripts/verify-sbom.js";

const manifest = { name: "@shipsolid/observegate", version: "1.2.3" };
const expectedPackages = [{ name: "yaml", version: "2.9.1", license: "ISC" }];

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
            },
            { name: "yaml", version: "2.9.1", purl: "pkg:npm/yaml@2.9.1" }
          ]
        },
        manifest,
        expectedPackages
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
        manifest,
        expectedPackages
      )
    ).toEqual([
      "SBOM does not identify @shipsolid/observegate@1.2.3",
      "SBOM omits bundled package yaml@2.9.1",
      "SBOM contains Action-only package @actions/core"
    ]);
  });

  it("derives every embedded package and version from the bundle map and lockfile", () => {
    expect(
      bundledPackages(
        {
          sources: [
            "../node_modules/yaml/browser/index.js",
            "C:\\repo\\node_modules\\@scope\\library\\index.js",
            "../packages/core/dist/index.js"
          ]
        },
        {
          packages: {
            "node_modules/yaml": { version: "2.9.1", license: "ISC" },
            "node_modules/@scope/library": { version: "4.0.0", license: "MIT" }
          }
        }
      )
    ).toEqual([
      { name: "@scope/library", version: "4.0.0", license: "MIT" },
      { name: "yaml", version: "2.9.1", license: "ISC" }
    ]);
  });

  it("finalizes a deterministic SBOM with bundle components and dependency edges", () => {
    const finalized = finalizeCycloneDx(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        metadata: {
          component: {
            "bom-ref": "observegate",
            type: "file",
            name: manifest.name,
            version: manifest.version
          }
        }
      },
      { sources: ["../node_modules/yaml/browser/index.js"] },
      { packages: { "node_modules/yaml": expectedPackages[0] } },
      "0"
    );
    expect(finalized.serialNumber).toBe(
      deterministicSerial("@shipsolid/observegate@1.2.3\nyaml@2.9.1")
    );
    expect(finalized.metadata).toMatchObject({
      timestamp: "1970-01-01T00:00:00.000Z",
      component: { type: "application" }
    });
    expect(finalized.components).toEqual([
      expect.objectContaining({ name: "yaml", version: "2.9.1", purl: "pkg:npm/yaml@2.9.1" })
    ]);
    expect(finalized.dependencies).toEqual([
      { ref: "observegate", dependsOn: ["pkg:npm/yaml@2.9.1"] }
    ]);
  });
});
