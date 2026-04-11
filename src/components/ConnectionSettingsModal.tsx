import { useMemo } from "react";
import type { ConnectionSettings } from "../types";

type ConnectionSettingsModalProps = {
  isOpen: boolean;
  settings: ConnectionSettings | null;
  isSaving: boolean;
  isTesting: boolean;
  testResult: string | null;
  onClose: () => void;
  onChange: (settings: ConnectionSettings) => void;
  onSave: () => void;
  onTest: () => void;
};

const PROVIDER_OPTIONS = [
  { value: "codex", label: "Local Codex" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "sjtu", label: "SJTU API" },
  { value: "openai", label: "OpenAI" },
  { value: "custom", label: "Custom API" },
] as const;

const CODEX_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"] as const;
const DEEPSEEK_MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "deepseek-chat（推荐）" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner" },
] as const;
const SJTU_MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "deepseek-chat（推荐）" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  { value: "glm-5", label: "glm-5" },
  { value: "minimax-m2.5", label: "minimax-m2.5" },
  { value: "qwen3coder", label: "qwen3coder" },
] as const;

export function ConnectionSettingsModal({
  isOpen,
  settings,
  isSaving,
  isTesting,
  testResult,
  onClose,
  onChange,
  onSave,
  onTest,
}: ConnectionSettingsModalProps) {
  const activeProvider = settings?.activeProvider ?? "codex";
  const currentSection = useMemo(() => {
    if (!settings) {
      return null;
    }
    if (activeProvider === "codex") {
      return (
        <>
          <label className="settings-field settings-field-wide">
            <span>Codex binary</span>
            <input
              aria-label="Codex binary"
              value={settings.codex.bin}
              onChange={(event) =>
                onChange({
                  ...settings,
                  codex: {
                    ...settings.codex,
                    bin: event.target.value,
                  },
                })
              }
            />
          </label>
          <label className="settings-field">
            <span>Codex model</span>
            <select
              aria-label="Codex model"
              value={settings.codex.model}
              onChange={(event) =>
                onChange({
                  ...settings,
                  codex: {
                    ...settings.codex,
                    model: event.target.value,
                  },
                })
              }
            >
              {CODEX_MODEL_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>Reasoning</span>
            <select
              aria-label="Reasoning"
              value={settings.codex.reasoningEffort}
              onChange={(event) =>
                onChange({
                  ...settings,
                  codex: {
                    ...settings.codex,
                    reasoningEffort: event.target.value as "low" | "medium" | "high",
                  },
                })
              }
            >
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
        </>
      );
    }

    const target =
      activeProvider === "deepseek"
        ? settings.deepseek
        : activeProvider === "sjtu"
          ? settings.sjtu
          : activeProvider === "custom"
            ? settings.custom
            : settings.openai;

    return (
      <>
        {activeProvider === "custom" ? (
          <label className="settings-field">
            <span>Provider label</span>
            <input
              aria-label="Provider label"
              value={settings.custom.label}
              onChange={(event) =>
                onChange({
                  ...settings,
                  custom: {
                    ...settings.custom,
                    label: event.target.value,
                  },
                })
              }
            />
          </label>
        ) : null}
        <label className={`settings-field ${activeProvider === "custom" ? "" : "settings-field-wide"}`.trim()}>
          <span>Base URL</span>
          <input
            aria-label="Base URL"
            value={target.baseUrl}
            onChange={(event) => {
              const nextValue = event.target.value;
              onChange({
                ...settings,
                [activeProvider]: {
                  ...target,
                  baseUrl: nextValue,
                },
              });
            }}
          />
        </label>
        {activeProvider === "deepseek" ? (
          <label className="settings-field">
            <span>Model name</span>
            <select
              aria-label="Model name"
              value={target.model}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange({
                  ...settings,
                  [activeProvider]: {
                    ...target,
                    model: nextValue,
                  },
                });
              }}
            >
              {DEEPSEEK_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : activeProvider === "sjtu" ? (
          <label className="settings-field">
            <span>Model name</span>
            <select
              aria-label="Model name"
              value={target.model}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange({
                  ...settings,
                  [activeProvider]: {
                    ...target,
                    model: nextValue,
                  },
                });
              }}
            >
              {SJTU_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="settings-field">
            <span>Model name</span>
            <input
              aria-label="Model name"
              value={target.model}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange({
                  ...settings,
                  [activeProvider]: {
                    ...target,
                    model: nextValue,
                  },
                });
              }}
            />
          </label>
        )}
        <label className="settings-field settings-field-wide">
          <span>API key</span>
          <input
            aria-label="API key"
            type="password"
            value={target.apiKey}
            onChange={(event) => {
              const nextValue = event.target.value;
              onChange({
                ...settings,
                [activeProvider]: {
                  ...target,
                  apiKey: nextValue,
                },
              });
            }}
          />
        </label>
      </>
    );
  }, [activeProvider, onChange, settings]);

  if (!isOpen || !settings) {
    return null;
  }

  return (
    <div className="settings-modal-backdrop">
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Connection settings">
        <header className="settings-modal-header">
          <div>
            <p className="panel-kicker">Connection</p>
            <h2>Connection settings</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="settings-grid">
          <label className="settings-field settings-field-wide">
            <span>Connection provider</span>
            <select
              aria-label="Connection provider"
              value={settings.activeProvider}
              onChange={(event) =>
                onChange({
                  ...settings,
                  activeProvider: event.target.value as ConnectionSettings["activeProvider"],
                })
              }
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {currentSection}
        </div>

        <footer className="settings-modal-footer">
          <div className="settings-test-result" aria-live="polite">
            {testResult}
          </div>
          <div className="settings-actions">
            <button type="button" className="secondary-button" onClick={onTest} disabled={isTesting || isSaving}>
              {isTesting ? "Testing..." : "Test connection"}
            </button>
            <button type="button" className="primary-button" onClick={onSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
