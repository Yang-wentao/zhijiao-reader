import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { PassageCard } from "../types";

type PassageCardProps = {
  card: PassageCard;
  questionActionLabel: string;
  onAsk: (cardId: string, question: string) => void;
  onDismiss: (cardId: string) => void;
  onToggle: (cardId: string) => void;
  onRetry: (cardId: string) => void;
  onNotice: (message: string) => void;
};

const QUICK_PROMPTS = [
  "这段的核心结论是什么？",
  "用更直白的中文重写。",
];

export function PassageCard({
  card,
  questionActionLabel,
  onAsk,
  onDismiss,
  onToggle,
  onRetry,
  onNotice,
}: PassageCardProps) {
  const [draftQuestion, setDraftQuestion] = useState("");
  const [loadingTick, setLoadingTick] = useState(0);
  const latestAssistantText = useMemo(() => {
    if (card.draftOutput) {
      return card.draftOutput;
    }
    const latestAssistant = [...card.messages].reverse().find((message) => message.role === "assistant");
    return latestAssistant?.content ?? "";
  }, [card.draftOutput, card.messages]);
  const loadingLabel = useMemo(() => {
    if (card.status === "streaming" && card.draftOutput) {
      return "正在生成…";
    }
    if (card.mode === "translate") {
      return LOADING_STEPS[loadingTick % LOADING_STEPS.length];
    }
    return ASK_LOADING_STEPS[loadingTick % ASK_LOADING_STEPS.length];
  }, [card.draftOutput, card.mode, card.status, loadingTick]);

  useEffect(() => {
    if (card.status !== "loading" && card.status !== "streaming") {
      setLoadingTick(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingTick((current) => current + 1);
    }, 900);

    return () => window.clearInterval(interval);
  }, [card.status]);

  const isBusy = card.status === "loading" || card.status === "streaming";
  const assistantLabel = card.mode === "translate" ? "译文" : "回答";

  async function copyText(text: string, successLabel: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        copyWithFallback(text);
      }
      onNotice(`已复制${successLabel}。`);
    } catch {
      try {
        copyWithFallback(text);
        onNotice(`已复制${successLabel}。`);
      } catch {
        onNotice("复制失败，请检查剪贴板权限。");
      }
    }
  }

  async function handleCopyOriginal() {
    if (!card.selectionText) {
      onNotice("还没有可复制的原文。");
      return;
    }
    await copyText(card.selectionText, "原文");
  }

  async function handleCopyAssistant() {
    if (!latestAssistantText) {
      onNotice(`还没有可复制的${assistantLabel}。`);
      return;
    }
    await copyText(latestAssistantText, assistantLabel);
  }

  return (
    <article className={`passage-card ${card.collapsed ? "collapsed" : ""}`}>
      <header className="card-header">
        <div className="card-header-meta">
          <div className="card-eyebrow">
            <span>{card.mode === "translate" ? "译文" : questionActionLabel}</span>
            <span>{card.pageNumber ? `第 ${card.pageNumber} 页` : "未识别页码"}</span>
          </div>
          {!card.collapsed ? (
            <div className="card-inline-actions">
              <button type="button" className="link-action" onClick={() => void handleCopyOriginal()}>
                复制原文
              </button>
              <span className="link-action-divider" aria-hidden="true">·</span>
              <button type="button" className="link-action" onClick={() => void handleCopyAssistant()}>
                复制{assistantLabel}
              </button>
              <span className="link-action-divider" aria-hidden="true">·</span>
              <button
                type="button"
                className="link-action"
                onClick={() => onRetry(card.id)}
                disabled={isBusy}
              >
                {isBusy ? "重试中…" : "重试"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="card-header-actions">
          <button
            type="button"
            className="card-icon-button"
            onClick={() => onToggle(card.id)}
            aria-label={card.collapsed ? "展开" : "折叠"}
            title={card.collapsed ? "展开" : "折叠"}
          >
            {card.collapsed ? "+" : "−"}
          </button>
          <button
            type="button"
            className="card-icon-button"
            onClick={() => onDismiss(card.id)}
            aria-label="关闭"
            title="关闭"
          >
            ×
          </button>
        </div>
        <p className="card-selection card-selection-preview">{card.selectionText}</p>
      </header>
      {!card.collapsed ? (
        <>
          <div className="message-list">
            {card.messages.map((message) => (
              <div key={message.id} className={`message-bubble message-${message.role}`}>
                <span className="message-role">{message.role === "user" ? "你的提问" : assistantLabel}</span>
                <div className="message-content">{renderRichContent(message.content)}</div>
              </div>
            ))}
            {card.status === "streaming" || card.status === "loading" ? (
              <div className="message-bubble message-assistant draft">
                <div className="message-status">
                  <span className="message-role">{assistantLabel}</span>
                  <span className="stream-badge">{loadingLabel}</span>
                </div>
                <div className="stream-meter" aria-hidden="true">
                  <span />
                </div>
                <div className="message-content">
                  {card.draftOutput ? renderRichContent(card.draftOutput) : <p>{loadingLabel}</p>}
                </div>
              </div>
            ) : null}
            {card.error ? <p className="error-text">{card.error}</p> : null}
          </div>
          <div className="quick-prompt-list">
            {QUICK_PROMPTS.map((prompt) => (
              <button key={prompt} type="button" className="chip-button" onClick={() => onAsk(card.id, prompt)}>
                {prompt}
              </button>
            ))}
          </div>
          <form
            className="card-input"
            onSubmit={(event) => {
              event.preventDefault();
              const nextQuestion = draftQuestion.trim();
              if (!nextQuestion) {
                return;
              }
              onAsk(card.id, nextQuestion);
              setDraftQuestion("");
            }}
          >
            <textarea
              value={draftQuestion}
              onChange={(event) => setDraftQuestion(event.target.value)}
              placeholder="继续追问这段内容…"
              rows={3}
            />
            <button type="submit" className="primary-button">
              提问
            </button>
          </form>
        </>
      ) : null}
    </article>
  );
}

const LOADING_STEPS = [
  "正在准备翻译…",
  "正在把段落发给模型…",
  "正在生成译文和术语注释…",
];

const ASK_LOADING_STEPS = [
  "正在整理你的问题…",
  "正在请求模型…",
  "正在生成回答…",
];

function renderParagraphs(content: string) {
  return splitParagraphs(mergeOrphanTags(content)).map((paragraph, index) => (
    <ReactMarkdown
      key={`${index}-${paragraph}`}
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => <p>{children}</p>,
      }}
    >
      {normalizeMathMarkdown(paragraph)}
    </ReactMarkdown>
  ));
}

function splitParagraphs(content: string) {
  return content
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function copyWithFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("document.execCommand('copy') failed");
  }
}

function renderRichContent(content: string) {
  return renderParagraphs(content);
}

function normalizeMathMarkdown(content: string) {
  const normalized = promoteInlineTagToDisplay(
    content
      .replace(/\\\\\[((?:.|\n)+?)\\\\\]/g, (_, math) => `$$${math.trim()}$$`)
      .replace(/\\\\\(((?:.|\n)+?)\\\\\)/g, (_, math) => `$${math.trim()}$`)
      .replace(/\\\[((?:.|\n)+?)\\\]/g, (_, math) => `$$${math.trim()}$$`)
      .replace(/\\\(((?:.|\n)+?)\\\)/g, (_, math) => `$${math.trim()}$`),
  );

  // Paragraph-level safety net for weaker models (gpt-5.4-mini, deepseek
  // v4-flash, ...) that emit a whole tagged equation as raw LaTeX with NO
  // $$ delimiters at all — e.g. `\begin{pmatrix}...\end{pmatrix} \sim N(...)
  // \tag{2.4}`. Wrap the whole paragraph in $$..$$ so KaTeX picks it up.
  // The threshold check inside wrapBareMathParagraph keeps prose paragraphs
  // that merely mention \tag from being mistakenly promoted into math mode.
  const wrapped = wrapBareMathParagraph(inlineTagToParenNumber(normalized));

  return fixDoubleSuperscripts(
    wrapped.replace(SINGLE_LINE_DISPLAY_MATH_REGEX, (_, body) => `\n\n$$\n${body.trim()}\n$$\n\n`),
  );
}

// `\tag{}` is only legal in DISPLAY math. When a model puts a numbered
// equation in single-dollar INLINE math — `$ E[\dots] \tag{5} $` — KaTeX
// throws "\tag works only in display mode" and paints the raw LaTeX red.
// Promoting such spans to their own $$ block is always safe: the inline form
// could never have rendered.
//
// The scan walks inline spans LEFT TO RIGHT so each `$` pairs with the next
// one, exactly like the Markdown parser does. Matching the tag directly with
// one regex is not safe: in `一阶：$A$ \tag{5}。二阶：$B$` it would pair the
// CLOSING dollar of A with the OPENING dollar of B and swallow the prose in
// between.
const INLINE_MATH_SPAN_REGEX = /\$[^\n$]+\$/g;

function promoteInlineTagToDisplay(content: string) {
  return content.replace(INLINE_MATH_SPAN_REGEX, (span, offset: number) => {
    // Skip spans that are really the inside of a `$$...$$` block — those are
    // display math already and are handled further down the pipeline.
    if (content[offset - 1] === "$" || content[offset + span.length] === "$") {
      return span;
    }
    if (!span.includes("\\tag{")) {
      return span;
    }
    return `\n\n$$\n${span.slice(1, -1).trim()}\n$$\n\n`;
  });
}

// Third \tag failure mode seen live: the model puts the number just OUTSIDE
// an inline formula — `一阶：$E[\dots]$ \tag{5}。` — where KaTeX never sees it
// and the reader gets a literal "\tag{5}". Since the tag clearly belongs to
// the formula it follows, render it the way the source PDF does: "(5)".
// Promoting to a display block instead would tear the sentence in half, and a
// tag with no adjacent math (see the orphan-tag test) is deliberately left
// alone — there is nothing it could belong to.
const TAG_AFTER_INLINE_MATH_REGEX = /(\$[^\n$]+\$)[ \t]*\\tag\{([^}]*)\}/g;

function inlineTagToParenNumber(content: string) {
  return content.replace(TAG_AFTER_INLINE_MATH_REGEX, (_, math: string, label: string) => `${math} (${label})`);
}

// A prime IS a superscript, so `\hat{Z}'_i^\top` is a double superscript —
// KaTeX (and real LaTeX) reject it, and the whole formula renders as red
// source. The canonical fix is an empty group before the second superscript:
// `\hat{Z}'_i{}^\top`. Applied ONLY inside math spans so prose is untouched,
// and only to prime-then-superscript sequences, which are always an error
// otherwise.
const MATH_SPAN_REGEX = /\$\$[\s\S]*?\$\$|\$[^\n$]+?\$/g;
const PRIME_DOUBLE_SUPERSCRIPT_REGEX = /'(\s*(?:_\{[^}]*\}|_\\?[A-Za-z0-9]+)?)\s*\^/g;

function fixDoubleSuperscripts(content: string) {
  return content.replace(MATH_SPAN_REGEX, (span) =>
    span.replace(PRIME_DOUBLE_SUPERSCRIPT_REGEX, (_, subscript: string) => `'${subscript}{}^`),
  );
}

// "Looks like a math equation paragraph that the model forgot to wrap" =
// has \tag{X}, has zero $ (so we're not inside any explicit math), has
// content beyond just \tag itself, AND has enough LaTeX commands to be
// distinguishable from prose that happens to mention the word "\tag".
// Three or more `\command` tokens is a comfortable threshold: real
// equations usually have many (\sim, \sigma, \begin, \left, ...), while
// prose mentioning \tag rarely does.
const BARE_MATH_COMMAND_THRESHOLD = 3;

function wrapBareMathParagraph(paragraph: string) {
  if (paragraph.includes("$")) return paragraph;
  if (!/\\tag\{[^}]+\}/.test(paragraph)) return paragraph;
  const withoutTag = paragraph.replace(/\\tag\{[^}]+\}/g, "").trim();
  if (!withoutTag) return paragraph;
  const commandCount = (paragraph.match(/\\[a-zA-Z]+/g) ?? []).length;
  if (commandCount < BARE_MATH_COMMAND_THRESHOLD) return paragraph;
  return `$$\n${paragraph.trim()}\n$$`;
}

// New-generation models often emit a display equation in one paragraph and
// drop \tag{X} as its own paragraph just below, e.g.
//
//   $$
//   X = Y + Z
//   $$
//
//   \tag{2.4}
//
// KaTeX needs the \tag inside the same display block as the expression it is
// tagging. Re-attach orphan tags BEFORE splitParagraphs so the merged block
// stays in one paragraph and renders with the equation number on the right.
const ORPHAN_TAG_AFTER_DISPLAY_REGEX = /\$\$([\s\S]*?)\$\$\s*\n+\s*(\\tag\{[^}]+\})/g;

function mergeOrphanTags(content: string) {
  return content.replace(
    ORPHAN_TAG_AFTER_DISPLAY_REGEX,
    (_, body: string, tag: string) => `$$\n${body.trim()} ${tag}\n$$`,
  );
}

// remark-math only treats $$..$$ as DISPLAY mode (the mode where \tag{} is
// allowed) when the $$ markers are on their own lines. A single-line block
// like `$$ X = Y \tag{1} $$` gets parsed as INLINE math, then KaTeX errors on
// \tag and renders the source in red. Force every $$..$$ block into the
// canonical multi-line form so display mode kicks in.
//   $$ X = Y \tag{1} $$   →   \n\n$$\nX = Y \tag{1}\n$$\n\n
// Surrounding the block with blank lines also guarantees that splitParagraphs
// will keep it as its own paragraph, so the renderer sees it cleanly.
const SINGLE_LINE_DISPLAY_MATH_REGEX = /\$\$([^\n$]+?)\$\$/g;
