import { describe, expect, it } from "vitest";
import { productName } from "../src/index.js";

describe("core workspace", () => {
  it("exports the product identity", () => {
    expect(productName).toBe("Observability Gate");
  });
});
