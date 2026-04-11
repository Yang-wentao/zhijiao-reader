import type { PassageCard as PassageCardType } from "../types";
import { PassageCard } from "./PassageCard";

type AssistantPanelProps = {
  cards: PassageCardType[];
  provider: "openai" | "codex" | "deepseek";
  providerOptions: Array<"openai" | "codex" | "deepseek">;
  canSwitchProviders: boolean;
  model: string;
  modelOptions: string[];
  canSwitchModels: boolean;
  reasoningEffort: "low" | "medium" | "high" | null;
  reasoningEffortOptions: Array<"low" | "medium" | "high">;
  canSwitchReasoningEffort: boolean;
  isUpdatingModel: boolean;
  questionActionLabel: string;
  onProviderChange: (provider: "openai" | "codex" | "deepseek") => void;
  onModelChange: (model: string) => void;
  onReasoningEffortChange: (reasoningEffort: "low" | "medium" | "high") => void;
  onAsk: (cardId: string, question: string) => void;
  onDismiss: (cardId: string) => void;
  onToggle: (cardId: string) => void;
  onRetry: (cardId: string) => void;
  onNotice: (message: string) => void;
};

export function AssistantPanel({
  cards,
  provider,
  providerOptions,
  canSwitchProviders,
  model,
  modelOptions,
  canSwitchModels,
  reasoningEffort,
  reasoningEffortOptions,
  canSwitchReasoningEffort,
  isUpdatingModel,
  questionActionLabel,
  onProviderChange,
  onModelChange,
  onReasoningEffortChange,
  onAsk,
  onDismiss,
  onToggle,
  onRetry,
  onNotice,
}: AssistantPanelProps) {
  return (
    <div className="assistant-panel">
      <header className="assistant-header">
        <div className="assistant-summary-row">
          <div className="assistant-title-group">
            <p className="panel-kicker">AI Reading Copilot</p>
            <h1>Codex Panel</h1>
          </div>
          <p className="panel-copy">
            Default flow: translate the selected passage, then keep asking follow-up questions in the same card.
          </p>
        </div>
        <div className="assistant-controls-row">
          <div className="model-chip-row">
            <span className="model-label">Current</span>
            <strong className="model-value">{model}</strong>
            <span className="model-provider">{formatProviderLabel(provider)}</span>
            {reasoningEffort ? <strong className="model-value model-effort">{reasoningEffort}</strong> : null}
          </div>
          {canSwitchProviders ? (
            <label className="model-switcher model-switcher-inline">
              <span className="model-switcher-label">Provider</span>
              <select
                aria-label="Provider"
                value={provider}
                onChange={(event) => onProviderChange(event.target.value as "openai" | "codex" | "deepseek")}
                disabled={isUpdatingModel}
              >
                {providerOptions.map((option) => (
                  <option key={option} value={option}>
                    {formatProviderLabel(option)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canSwitchModels ? (
            <label className="model-switcher model-switcher-inline">
              <span className="model-switcher-label">Model</span>
              <select
                aria-label="Model"
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                disabled={isUpdatingModel}
              >
                {modelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canSwitchReasoningEffort && reasoningEffort ? (
            <label className="model-switcher model-switcher-inline">
              <span className="model-switcher-label">Reasoning</span>
              <select
                aria-label="Reasoning"
                value={reasoningEffort}
                onChange={(event) => onReasoningEffortChange(event.target.value as "low" | "medium" | "high")}
                disabled={isUpdatingModel}
              >
                {reasoningEffortOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
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

function formatProviderLabel(provider: "openai" | "codex" | "deepseek") {
  if (provider === "deepseek") {
    return "DeepSeek";
  }
  if (provider === "codex") {
    return "Local Codex";
  }
  return "OpenAI";
}
