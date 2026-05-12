import { useEffect, useRef, useState } from "react";
import type { PassageCard as PassageCardType } from "../types";
import { PassageCard } from "./PassageCard";

type AssistantPanelProps = {
  cards: PassageCardType[];
  provider: "openai" | "codex" | "deepseek" | "sjtu" | "custom";
  connectionLabel: string;
  model: string;
  isUpdatingModel: boolean;
  questionActionLabel: string;
  onOpenSettings: () => void;
  onAsk: (cardId: string, question: string) => void;
  onDismiss: (cardId: string) => void;
  onToggle: (cardId: string) => void;
  onRetry: (cardId: string) => void;
  onNotice: (message: string) => void;
};

// Discrete levels (1..N) for the right-pane font + line-height. We use levels
// rather than raw px so future tweaks to the visual scale only touch this file.
const FONT_SIZE_LEVELS = [12, 13, 14, 15, 16, 17, 18, 20] as const;
const LINE_HEIGHT_LEVELS = [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1] as const;
const DEFAULT_FONT_LEVEL = 3; // → 15px
const DEFAULT_LINE_LEVEL = 3; // → 1.5
const FONT_LEVEL_STORAGE_KEY = "zhijiao-right-font-level";
const LINE_LEVEL_STORAGE_KEY = "zhijiao-right-line-level";
const SCROLL_TOP_THRESHOLD = 200;

export function AssistantPanel({
  cards,
  provider,
  connectionLabel,
  model,
  isUpdatingModel,
  questionActionLabel,
  onOpenSettings,
  onAsk,
  onDismiss,
  onToggle,
  onRetry,
  onNotice,
}: AssistantPanelProps) {
  const cardStackRef = useRef<HTMLDivElement | null>(null);
  const previousCardCountRef = useRef(cards.length);
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const [fontLevel, setFontLevel] = useState<number>(() =>
    readStoredLevel(FONT_LEVEL_STORAGE_KEY, FONT_SIZE_LEVELS.length, DEFAULT_FONT_LEVEL),
  );
  const [lineLevel, setLineLevel] = useState<number>(() =>
    readStoredLevel(LINE_LEVEL_STORAGE_KEY, LINE_HEIGHT_LEVELS.length, DEFAULT_LINE_LEVEL),
  );
  const [isTypoOpen, setIsTypoOpen] = useState(false);
  const typoRef = useRef<HTMLDivElement | null>(null);

  // Persist both knobs separately so the user can dial each one to whatever
  // value works best on their screen and have it survive restarts.
  useEffect(() => {
    safeLocalStorage()?.setItem(FONT_LEVEL_STORAGE_KEY, String(fontLevel));
  }, [fontLevel]);
  useEffect(() => {
    safeLocalStorage()?.setItem(LINE_LEVEL_STORAGE_KEY, String(lineLevel));
  }, [lineLevel]);

  // Auto-scroll the card stack to the top when a new card is created. New cards
  // are prepended (`[card, ...rest]` in cards.ts), so the freshly added card
  // sits at scrollTop = 0 — without auto-scroll the user wouldn't know it's
  // there if they were reading further down. We compare lengths via a ref so we
  // only fire on add, never on dismiss / toggle / streaming-content updates.
  useEffect(() => {
    if (cards.length > previousCardCountRef.current) {
      safeScrollToTop(cardStackRef.current);
    }
    previousCardCountRef.current = cards.length;
  }, [cards.length]);

  // Track scroll position so the floating "back to top" button only appears
  // when there's something useful to scroll back to.
  useEffect(() => {
    const el = cardStackRef.current;
    if (!el) return;
    const handler = () => setIsScrolledDown(el.scrollTop > SCROLL_TOP_THRESHOLD);
    handler();
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [cards.length]);

  // Close the typography popover when the user clicks anywhere outside of it.
  useEffect(() => {
    if (!isTypoOpen) return;
    function handleDocClick(event: MouseEvent) {
      if (typoRef.current && !typoRef.current.contains(event.target as Node)) {
        setIsTypoOpen(false);
      }
    }
    function handleEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setIsTypoOpen(false);
    }
    window.addEventListener("mousedown", handleDocClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleDocClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [isTypoOpen]);

  function scrollToTop() {
    safeScrollToTop(cardStackRef.current);
  }

  const fontPx = FONT_SIZE_LEVELS[Math.min(Math.max(fontLevel, 0), FONT_SIZE_LEVELS.length - 1)];
  const lineH = LINE_HEIGHT_LEVELS[Math.min(Math.max(lineLevel, 0), LINE_HEIGHT_LEVELS.length - 1)];

  return (
    <div
      className="assistant-panel"
      style={
        {
          "--right-font-size": `${fontPx}px`,
          "--right-line-height": String(lineH),
        } as React.CSSProperties
      }
    >
      <header className="assistant-header">
        <div className="assistant-summary-row assistant-summary-row-compact">
          <div className="assistant-title-group">
            <h1>知交文献阅读</h1>
          </div>
          <div className="assistant-header-actions">
            <div className="typography-control" ref={typoRef}>
              <button
                type="button"
                className="icon-button typography-trigger"
                onClick={() => setIsTypoOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={isTypoOpen}
                aria-label="调整字号与行距"
                title="调整字号与行距"
              >
                Aa
              </button>
              {isTypoOpen ? (
                <div className="typography-popover" role="dialog" aria-label="排版">
                  <TypoRow
                    label="字号"
                    valueLabel={`${fontPx}px`}
                    onDecrement={() => setFontLevel((l) => Math.max(0, l - 1))}
                    onIncrement={() => setFontLevel((l) => Math.min(FONT_SIZE_LEVELS.length - 1, l + 1))}
                    canDecrement={fontLevel > 0}
                    canIncrement={fontLevel < FONT_SIZE_LEVELS.length - 1}
                    isDefault={fontLevel === DEFAULT_FONT_LEVEL}
                    onReset={() => setFontLevel(DEFAULT_FONT_LEVEL)}
                  />
                  <TypoRow
                    label="行距"
                    valueLabel={lineH.toFixed(2)}
                    onDecrement={() => setLineLevel((l) => Math.max(0, l - 1))}
                    onIncrement={() => setLineLevel((l) => Math.min(LINE_HEIGHT_LEVELS.length - 1, l + 1))}
                    canDecrement={lineLevel > 0}
                    canIncrement={lineLevel < LINE_HEIGHT_LEVELS.length - 1}
                    isDefault={lineLevel === DEFAULT_LINE_LEVEL}
                    onReset={() => setLineLevel(DEFAULT_LINE_LEVEL)}
                  />
                </div>
              ) : null}
            </div>
            <div
              className="model-chip-row model-chip-row-compact"
              aria-label={`当前连接：${formatProviderLabel(provider)} · ${model}`}
              // The full connection label (incl. reasoning effort) lives in the
              // hover tooltip so curious users can still see it without the
              // chip taking up two lines on a narrow right pane.
              title={connectionLabel}
            >
              <span className="model-provider">{formatProviderLabel(provider)}</span>
              <strong className="model-value">{shortenModelName(provider, model)}</strong>
            </div>
            <button type="button" className="secondary-button" onClick={onOpenSettings} disabled={isUpdatingModel}>
              设置
            </button>
          </div>
        </div>
      </header>
      {cards.length > 20 ? (
        <div className="inline-warning">
          已经打开 20 张以上卡片，建议关闭旧的以保持流畅。
        </div>
      ) : null}
      {cards.length === 0 ? (
        <div className="empty-state empty-state-panel">
          <h2>在左侧 PDF 中选取一段文字</h2>
          <p>选中后这里会自动生成译文卡片，也可以继续追问该段落。</p>
          <ul className="empty-state-tips">
            <li>支持公式和 markdown 渲染</li>
            <li>右上角 <strong>设置</strong> 可切换模型与服务方</li>
            <li>同一段可以多次追问，卡片会保留对话上下文</li>
          </ul>
        </div>
      ) : (
        <div ref={cardStackRef} className="card-stack">
          {cards.map((card) => (
            <PassageCard
              key={card.id}
              card={card}
              questionActionLabel={questionActionLabel}
              onAsk={onAsk}
              onDismiss={onDismiss}
              onToggle={onToggle}
              onRetry={onRetry}
              onNotice={onNotice}
            />
          ))}
        </div>
      )}
      {isScrolledDown && cards.length > 0 ? (
        <button
          type="button"
          className="scroll-to-top-fab"
          onClick={scrollToTop}
          aria-label="回到顶部"
          title="回到顶部"
        >
          ↑
        </button>
      ) : null}
    </div>
  );
}

type TypoRowProps = {
  label: string;
  valueLabel: string;
  canDecrement: boolean;
  canIncrement: boolean;
  isDefault: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
  onReset: () => void;
};

function TypoRow({
  label,
  valueLabel,
  canDecrement,
  canIncrement,
  isDefault,
  onDecrement,
  onIncrement,
  onReset,
}: TypoRowProps) {
  return (
    <div className="typography-row">
      <span className="typography-row-label">{label}</span>
      <button
        type="button"
        className="icon-button typography-step"
        onClick={onDecrement}
        disabled={!canDecrement}
        aria-label={`减小${label}`}
      >
        −
      </button>
      <span className="typography-row-value" aria-live="polite">
        {valueLabel}
      </span>
      <button
        type="button"
        className="icon-button typography-step"
        onClick={onIncrement}
        disabled={!canIncrement}
        aria-label={`增大${label}`}
      >
        +
      </button>
      <button
        type="button"
        className="typography-reset"
        onClick={onReset}
        disabled={isDefault}
        aria-label={`重置${label}`}
        title="重置为默认"
      >
        默认
      </button>
    </div>
  );
}

function readStoredLevel(key: string, length: number, fallback: number): number {
  const raw = safeLocalStorage()?.getItem(key);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(0, Math.floor(parsed)), length - 1);
}

// jsdom (used by vitest) doesn't implement Element.scrollTo, so guard the call
// to keep components renderable under the test runner.
function safeScrollToTop(el: HTMLElement | null) {
  if (!el) return;
  try {
    if (typeof el.scrollTo === "function") {
      el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      el.scrollTop = 0;
    }
  } catch {
    // ignore — auto-scroll is a polish feature, never block render on it
  }
}

// Wrap window.localStorage so the component still renders in test environments
// where localStorage is stubbed or unavailable.
function safeLocalStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    if (typeof window.localStorage?.getItem !== "function") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function formatProviderLabel(provider: "openai" | "codex" | "deepseek" | "sjtu" | "custom") {
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  if (provider === "sjtu") {
    return "SJTU API";
  }
  if (provider === "codex") {
    return "Local Codex";
  }
  if (provider === "custom") {
    return "Custom API";
  }
  return "OpenAI";
}

// Strip a redundant provider-name prefix from the model so the chip stays compact.
// Example: "deepseek-chat" under the DeepSeek provider → "chat"; "glm-5" stays as-is.
function shortenModelName(
  provider: "openai" | "codex" | "deepseek" | "sjtu" | "custom",
  model: string,
) {
  if (!model) {
    return model;
  }
  const lower = model.toLowerCase();
  if (provider === "deepseek" && lower.startsWith("deepseek-")) {
    return model.slice("deepseek-".length);
  }
  return model;
}
