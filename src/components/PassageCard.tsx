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
  return splitParagraphs(content).map((paragraph, index) => (
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
  return content
    .replace(/\\\\\[((?:.|\n)+?)\\\\\]/g, (_, math) => `$$${math.trim()}$$`)
    .replace(/\\\\\(((?:.|\n)+?)\\\\\)/g, (_, math) => `$${math.trim()}$`)
    .replace(/\\\[((?:.|\n)+?)\\\]/g, (_, math) => `$$${math.trim()}$$`)
    .replace(/\\\(((?:.|\n)+?)\\\)/g, (_, math) => `$${math.trim()}$`);
}
