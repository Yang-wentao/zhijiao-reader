import type { PassageCard as PassageCardType } from "../types";
import { PassageCard } from "./PassageCard";

type AssistantPanelProps = {
  cards: PassageCardType[];
  provider: "openai" | "codex" | "deepseek" | "sjtu" | "custom";
  connectionLabel: string;
  model: string;
  reasoningEffort: "low" | "medium" | "high" | null;
  isUpdatingModel: boolean;
  questionActionLabel: string;
  onOpenSettings: () => void;
  onAsk: (cardId: string, question: string) => void;
  onDismiss: (cardId: string) => void;
  onToggle: (cardId: string) => void;
  onRetry: (cardId: string) => void;
  onNotice: (message: string) => void;
};

export function AssistantPanel({
  cards,
  provider,
  connectionLabel,
  model,
  reasoningEffort,
  isUpdatingModel,
  questionActionLabel,
  onOpenSettings,
  onAsk,
  onDismiss,
  onToggle,
  onRetry,
  onNotice,
}: AssistantPanelProps) {
  return (
    <div className="assistant-panel">
      <header className="assistant-header">
        <div className="assistant-summary-row assistant-summary-row-compact">
          <div className="assistant-title-group">
            <h1>Codex Panel</h1>
          </div>
          <div className="assistant-header-actions">
            <div className="model-chip-row model-chip-row-compact" aria-label="Current connection">
              <span className="model-provider">{formatProviderLabel(provider)}</span>
              <strong className="model-value">{model}</strong>
              {reasoningEffort ? <strong className="model-value model-effort">{reasoningEffort}</strong> : null}
            </div>
            <button type="button" className="secondary-button" onClick={onOpenSettings} disabled={isUpdatingModel}>
              Settings
            </button>
          </div>
        </div>
        <p className="connection-inline-label">{connectionLabel}</p>
      </header>
      {cards.length > 20 ? (
        <div className="inline-warning">
          More than 20 cards are open. Dismiss older cards to keep the interface responsive.
        </div>
      ) : null}
      {cards.length === 0 ? (
        <div className="empty-state empty-state-panel">
          <h2>Select a passage in the PDF</h2>
          <p>The right panel will create a new card for translation or Q&amp;A.</p>
        </div>
      ) : (
        <div className="card-stack">
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
    </div>
  );
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
