import { describe, expect, it } from "vitest";
import { clampRatio } from "./SplitLayout";

describe("clampRatio", () => {
  it("keeps the divider within the supported bounds", () => {
    expect(clampRatio(0.3)).toBe(0.5);
    expect(clampRatio(0.68)).toBe(0.68);
    expect(clampRatio(0.9)).toBe(0.8);
  });
});
