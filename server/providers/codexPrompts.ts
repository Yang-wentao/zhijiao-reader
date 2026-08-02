import type { AskInput, TranslationInput } from "./types.js";

// Math + term-explanation rules — kept in sync with server/prompts.ts.
// Codex is a CLI subprocess so we splice the rules straight into one big string
// (no system/user message split available).
const FORMATTING_RULES = `OUTPUT RULES — math delimiters (strict):
- Inline math uses $...$. Display math uses $$...$$. Never use \\(...\\) or \\[...\\] (this app's Markdown renderer ignores them).
- Inline math MUST have whitespace on BOTH sides: write "所以 $X = Y$ 是" (good), not "所以$X=Y$是" (bad — adjacent Chinese disables the formula).
- Every $ must close with $; every $$ must close with $$. Double-check pairing in long paragraphs with many inline formulas.

OUTPUT RULES — equation numbers (very common failure mode):
Numbers like (8), (2.3a), (S.1) MUST be moved INSIDE the display block via \\tag{...}. Putting them outside breaks the renderer.
  Right:  $$ X = Y + Z \\tag{8} $$
  Wrong:  $$ X = Y + Z $$ (8)
  Wrong:  $$ X = Y + Z (8) $$

CRITICAL — \\tag{} ONLY works inside $$...$$. Writing \\tag{3} without surrounding $$ makes the entire line render as raw text. Every \\tag MUST be paired with both an opening $$ AND a closing $$ on the same line or paragraph. Before sending output, scan it once: if \\tag{ appears anywhere, verify the $$...$$ wrap is present.
Single-dollar INLINE math must NEVER contain \\tag: "$ E[...] \\tag{5} $" is an error. A numbered equation always gets its own $$ ... $$ display block on its own line.

OUTPUT RULES — primes and transposes:
A prime ' already IS a superscript, so a second superscript right after it is an error (\\hat{Z}'_i^\\top fails to render). Wrap the primed symbol in braces:
  Right:  {\\hat{Z}'_i}^\\top   and   {X'}^2
  Wrong:  \\hat{Z}'_i^\\top     and   X'^2

OUTPUT RULES — preserve math structure:
Keep every subscript, superscript, integral, sum, fraction, absolute value, inequality and norm exactly as in the source. Do not paraphrase formulas into Chinese prose.

OUTPUT RULES — term-explanation section:
After the main translation, if any technical term, abbreviation, or unusual phrasing deserves explanation, append ONE section titled exactly:
  术语解释
Each entry is ONE plain paragraph (no list markers, no bold, no numbering) shaped exactly:
  术语名（English）：中文解释。
Leave a blank line between entries.

DON'TS:
- Do not invent details that are not in the source passage.
- Do not embed long English sentences in the Chinese (proper nouns are fine).
- Do not include an English back-translation.
- Do not run shell commands or inspect files.`;

const TRANSLATE_EXAMPLE = `EXAMPLE
Source:
"""
Consider $S_{ab} = \\Pr(X_T > t, X_E > t \\mid Y_T = a, Y_E = b)$ for $a, b \\in \\{0, 1\\}$. By Bayes' rule we obtain
   X = Y + Z      (8)
where the BDA approach extends the classical method.
"""

Expected Chinese translation:
"""
考虑 $S_{ab} = \\Pr(X_T > t, X_E > t \\mid Y_T = a, Y_E = b)$ ，其中 $a, b \\in \\{0, 1\\}$ 。由 Bayes 公式可得：

$$ X = Y + Z \\tag{8} $$

其中 BDA 方法对经典方法做了扩展。

术语解释

BDA（Bayesian Data Augmentation）：贝叶斯数据扩增，一种利用后验抽样补全缺失观测的统计方法。
"""`;

export function buildCodexTranslationPrompt(input: TranslationInput) {
  return [
    "You are an academic translation assistant for English research papers.",
    "Translate the selected passage into accurate, natural Chinese suitable for a Chinese reader of the field.",
    "Respond only with the final Chinese translation in plain text — do not add commentary.",
    "",
    FORMATTING_RULES,
    "",
    TRANSLATE_EXAMPLE,
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
    "You are a research-paper reading assistant.",
    "Answer the user's question in concise, technically precise Chinese, using the selected passage as the primary source of truth.",
    "If the question goes beyond what the passage actually says, state that explicitly rather than inventing content.",
    "Respond only with the final answer in plain text.",
    "",
    FORMATTING_RULES,
    "",
    "ANSWER STYLE:",
    "- Default to short, focused answers. Add detail only when explicitly asked.",
    "- When citing equations from the passage, equation numbers go inside the $$ block via \\tag{}.",
    "- The 术语解释 section is OPTIONAL when answering questions — include it only when the answer clarifies a new technical term.",
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
