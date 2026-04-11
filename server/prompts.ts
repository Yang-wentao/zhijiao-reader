import type { ChatMessage } from "./providers/types";

export const TRANSLATE_SYSTEM_PROMPT = [
  "You are an academic translation assistant.",
  "Translate the selected English paper passage into accurate, natural Chinese.",
  "Preserve mathematical expressions exactly and rewrite them with standard LaTeX math delimiters: use $...$ for inline math and $$...$$ for display math.",
  "If the source passage places a formula on its own line, keep it on its own line and render it with $$...$$.",
  "Do not leave formulas as plain escaped markdown like \\(...\\) unless they are already valid LaTeX math content.",
  "If technical terms, abbreviations, or unusual grammar need explanation, add a separate section titled '术语解释'.",
  "Inside that section, put each term explanation in its own paragraph, leaving a blank line between items.",
  "Do not invent details that are not present in the selected passage.",
].join(" ");

export const ASK_SYSTEM_PROMPT = [
  "You are a research paper reading assistant.",
  "Answer questions using the selected passage as the primary source of truth.",
  "When mathematical expressions are needed, format them with standard LaTeX math delimiters: $...$ for inline math and $$...$$ for display math.",
  "If a cited equation from the passage is displayed separately, keep it as displayed math with $$...$$ instead of folding it into plain prose.",
  "If the user's question goes beyond the selected passage, say so explicitly instead of pretending the passage contains that information.",
  "Prefer concise, technically precise answers in Chinese unless the user asks otherwise.",
].join(" ");

export function buildTranslationMessages(selectionText: string, pageNumber: number | null): ChatMessage[] {
  return [
    { role: "developer", content: TRANSLATE_SYSTEM_PROMPT },
    {
      role: "user",
      content: formatSelection(selectionText, pageNumber) + "\n\nPlease translate this passage into Chinese.",
    },
  ];
}

export function buildAskMessages(
  selectionText: string,
  pageNumber: number | null,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
): ChatMessage[] {
  return [
    { role: "developer", content: ASK_SYSTEM_PROMPT },
    {
      role: "user",
      content: formatSelection(selectionText, pageNumber),
    },
    ...history,
    {
      role: "user",
      content: question.trim(),
    },
  ];
}

function formatSelection(selectionText: string, pageNumber: number | null): string {
  const pageLine = pageNumber == null ? "Page: unknown" : `Page: ${pageNumber}`;
  return `${pageLine}\nSelected passage:\n"""\n${selectionText.trim()}\n"""`;
}
