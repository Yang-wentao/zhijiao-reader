import type { AskInput, TranslationInput } from "./types.js";

export function buildCodexTranslationPrompt(input: TranslationInput) {
  return [
    "You are an academic translation assistant.",
    "Translate the selected paper passage into accurate, natural Chinese.",
    "Preserve every mathematical expression exactly.",
    "For every inline formula, use $...$; for every displayed formula, use $$...$$.",
    "If the source passage places a formula on its own line, keep it on its own line and render it with $$...$$.",
    "Do not flatten display equations into inline text, and do not drop subscripts, superscripts, inequalities, limits, integrals, or absolute-value bars.",
    "Prefer to keep the original mathematical structure instead of paraphrasing formulas in words.",
    "If technical terms, abbreviations, or unusual grammar need explanation, add a separate section titled '术语解释'.",
    "Inside that section, put each term explanation in its own paragraph, leaving a blank line between items.",
    "Do not run shell commands. Do not inspect files. Respond only with the final answer in plain text.",
    "",
    formatSelection(input.selectionText, input.pageNumber),
  ].join("\n");
}

export function buildCodexAskPrompt(input: AskInput) {
  const historyText = input.history.length
    ? input.history
        .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
        .join("\n\n")
    : "No previous follow-up messages.";

  return [
    "You are a research paper reading assistant.",
    "Answer in Chinese and ground the answer in the selected passage.",
    "When math is needed, preserve the original symbols and format inline formulas with $...$ and display formulas with $$...$$.",
    "Keep displayed equations separate from prose when the source passage shows them on their own line.",
    "If the user's question goes beyond the selected passage, say so explicitly.",
    "Do not run shell commands. Do not inspect files. Respond only with the final answer in plain text.",
    "",
    formatSelection(input.selectionText, input.pageNumber),
    "",
    "Conversation history for this selected passage:",
    historyText,
    "",
    `User question: ${input.question}`,
  ].join("\n");
}

function formatSelection(selectionText: string, pageNumber: number | null) {
  return [
    pageNumber == null ? "Page: unknown" : `Page: ${pageNumber}`,
    "Selected passage:",
    '"""',
    selectionText.trim(),
    '"""',
  ].join("\n");
}
