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
            <h1>知交文献阅读</h1>
          </div>
          <div className="assistant-header-actions">
            <div
              className="model-chip-row model-chip-row-compact"
              aria-label={`当前连接：${formatProviderLabel(provider)} · ${model}`}
              title={connectionLabel}
            >
              <span className="model-provider">{formatProviderLabel(provider)}</span>
              <strong className="model-value">{shortenModelName(provider, model)}</strong>
              {reasoningEffort ? <strong className="model-value model-effort">{reasoningEffort}</strong> : null}
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
            <li>右上角 <strong>Settings</strong> 可切换模型与服务方</li>
            <li>同一段可以多次追问，卡片会保留对话上下文</li>
          </ul>
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
