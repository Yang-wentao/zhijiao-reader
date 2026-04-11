import { describe, expect, it } from "vitest";
import { buildCodexAskPrompt, buildCodexTranslationPrompt } from "./codexPrompts";

describe("codex prompts", () => {
  it("forces translation prompt to preserve formulas with latex delimiters", () => {
    const prompt = buildCodexTranslationPrompt({
      selectionText: "F(d, b) = exp(b + d)/{1 + exp(b + d)}",
      pageNumber: 5,
    });

    expect(prompt).toContain("For every inline formula, use $...$; for every displayed formula, use $$...$$.");
    expect(prompt).toContain("Preserve every mathematical expression exactly");
    expect(prompt).toContain("If the source passage places a formula on its own line");
  });

  it("forces ask prompt to answer with latex-delimited math when needed", () => {
    const prompt = buildCodexAskPrompt({
      selectionText: "Condition 1(b) is equivalent to ...",
      pageNumber: 5,
      question: "这段的核心结论是什么？",
      history: [],
    });

    expect(prompt).toContain("When math is needed");
    expect(prompt).toContain("$...$");
  });
});
