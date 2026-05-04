import { describe, expect, it } from "vitest";
import { buildCodexAskPrompt, buildCodexTranslationPrompt } from "./codexPrompts";

describe("codex prompts", () => {
  it("forces translation prompt to use $-style delimiters and \\tag{} for equation numbers", () => {
    const prompt = buildCodexTranslationPrompt({
      selectionText: "F(d, b) = exp(b + d)/{1 + exp(b + d)}",
      pageNumber: 5,
    });

    // Math delimiter rules
    expect(prompt).toContain("Inline math uses $...$");
    expect(prompt).toContain("Display math uses $$...$$");
    expect(prompt).toContain("Never use \\(...\\) or \\[...\\]");
    // Equation-number rule (the critical regression we are guarding against)
    expect(prompt).toContain("\\tag{");
    // Term-explanation section title
    expect(prompt).toContain("术语解释");
    // Few-shot example must be present
    expect(prompt).toContain("EXAMPLE");
    // Selection passes through verbatim
    expect(prompt).toContain("F(d, b) = exp(b + d)/{1 + exp(b + d)}");
  });

  it("forces ask prompt to share the same math formatting rules", () => {
    const prompt = buildCodexAskPrompt({
      selectionText: "Condition 1(b) is equivalent to ...",
      pageNumber: 5,
      question: "这段的核心结论是什么？",
      history: [],
    });

    expect(prompt).toContain("Inline math uses $...$");
    expect(prompt).toContain("\\tag{");
    expect(prompt).toContain("术语解释");
    // Question and selection both make it into the final prompt.
    expect(prompt).toContain("这段的核心结论是什么？");
    expect(prompt).toContain("Condition 1(b) is equivalent to ...");
  });
});
