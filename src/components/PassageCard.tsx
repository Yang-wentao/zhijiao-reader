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
  "这段在说什么？",
  "这段的核心结论是什么？",
  "用更直白的中文重写。",
  "这段里隐含了哪些假设？",
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
      return "Streaming response";
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

  async function handleCopy() {
    const textToCopy = latestAssistantText || card.selectionText;
    if (!textToCopy) {
      onNotice("There is nothing to copy yet.");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        copyWithFallback(textToCopy);
      }
      onNotice("Copied the latest assistant response.");
    } catch {
      try {
        copyWithFallback(textToCopy);
        onNotice("Copied the latest assistant response.");
      } catch {
        onNotice("Copy failed. Check clipboard permissions and try again.");
      }
    }
  }

  const isBusy = card.status === "loading" || card.status === "streaming";

  return (
    <article className={`passage-card ${card.collapsed ? "collapsed" : ""}`}>
      <header className="card-header">
        <div className="card-header-meta">
          <div className="card-eyebrow">
            <span>{card.mode === "translate" ? "Translate" : questionActionLabel}</span>
            <span>{card.pageNumber ? `Page ${card.pageNumber}` : "Page unknown"}</span>
          </div>
        </div>
        <div className="card-header-actions">
          <button type="button" className="icon-button" onClick={() => onToggle(card.id)}>
            {card.collapsed ? "Expand" : "Collapse"}
          </button>
          <button type="button" className="icon-button" onClick={() => onDismiss(card.id)}>
            Close
          </button>
        </div>
        <p className="card-selection card-selection-preview">{card.selectionText}</p>
      </header>
      {!card.collapsed ? (
        <>
          <div className="card-actions">
            <button type="button" className="secondary-button" onClick={() => void handleCopy()}>
              Copy
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => onRetry(card.id)}
              disabled={isBusy}
            >
              {isBusy ? "Retrying..." : "Retry"}
            </button>
          </div>
          <div className="message-list">
            {card.messages.map((message) => (
              <div key={message.id} className={`message-bubble message-${message.role}`}>
                <span className="message-role">{message.role === "user" ? "You" : "Assistant"}</span>
                <div className="message-content">{renderRichContent(message.content)}</div>
              </div>
            ))}
            {card.status === "streaming" || card.status === "loading" ? (
              <div className="message-bubble message-assistant draft">
                <div className="message-status">
                  <span className="message-role">Assistant</span>
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
              placeholder="Ask a follow-up question about this passage..."
              rows={3}
            />
            <button type="submit" className="primary-button">
              Send
            </button>
          </form>
        </>
      ) : null}
    </article>
  );
}

const LOADING_STEPS = [
  "Preparing translation",
  "Sending the passage to the current model",
  "Generating translation and term notes",
];

const ASK_LOADING_STEPS = [
  "Preparing follow-up question",
  "Asking the current model",
  "Drafting the answer",
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
