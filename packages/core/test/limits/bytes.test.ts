import { describe, expect, it } from "vitest";
import { parseByteSize } from "../../src/index.js";

describe("parseByteSize", () => {
  it("parses configured byte units", () => {
    expect(parseByteSize("10MiB", 1)).toBe(10 * 1024 * 1024);
    expect(parseByteSize("1.5 KiB", 1)).toBe(1_536);
    expect(parseByteSize(25, 1)).toBe(25);
  });

  it("uses the fallback for invalid or non-positive limits", () => {
    expect(parseByteSize("10MB", 7)).toBe(7);
    expect(parseByteSize("0MiB", 7)).toBe(7);
    expect(parseByteSize("0.1B", 7)).toBe(7);
    expect(parseByteSize(0, 7)).toBe(7);
    expect(parseByteSize(undefined, 7)).toBe(7);
  });
});
