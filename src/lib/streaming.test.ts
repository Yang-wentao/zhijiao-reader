import { describe, expect, it } from "vitest";
import { splitIntoReadableChunks } from "./streaming";

describe("splitIntoReadableChunks", () => {
  it("prefers sentence-like chunks over fixed-width slicing", () => {
    const chunks = splitIntoReadableChunks("第一句。第二句。第三句。");

    expect(chunks).toEqual(["第一句。", "第二句。", "第三句。"]);
  });

  it("falls back to smaller slices for long formula-heavy lines", () => {
    const chunks = splitIntoReadableChunks("F(d, b) = exp(b + d)/{1 + exp(b + d)} and more symbols keep going without punctuation");

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toContain("F(d, b)");
  });
});
