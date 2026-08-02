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

// Grouped so the hosted option reads as the easy default, and the
// bring-your-own-key providers stay one click away rather than hidden.
const PROVIDER_GROUPS = [
  {
    label: "订阅版",
    options: [{ value: "cloud", label: "知交订阅（推荐 · 无需申请 API）" }],
  },
  {
    label: "自带 API key（免费）",
    options: [
      { value: "deepseek", label: "DeepSeek" },
      { value: "sjtu", label: "SJTU API" },
      { value: "openai", label: "OpenAI" },
      { value: "custom", label: "Custom API" },
    ],
  },
  {
    label: "高级",
    options: [{ value: "codex", label: "Local Codex" }],
  },
] as const;

const CODEX_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"] as const;
const DEEPSEEK_MODEL_OPTIONS = [
  { value: "deepseek-v4-flash", label: "v4-flash（推荐 · 1M 上下文）" },
  { value: "deepseek-v4-pro", label: "v4-pro（更强 · 当前 75% 折扣）" },
] as const;
const DEEPSEEK_THINKING_OPTIONS = [
  { value: "disabled", label: "非思考（更快）" },
  { value: "enabled", label: "深度思考（更细）" },
] as const;
const SJTU_MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "deepseek-chat（推荐）" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  { value: "glm-5", label: "glm-5" },
  { value: "minimax-m2.5", label: "minimax-m2.5" },
  { value: "qwen3coder", label: "qwen3coder" },
] as const;
const OPENAI_MODEL_OPTIONS = [
  { value: "gpt-5.5", label: "gpt-5.5（最强）" },
  { value: "gpt-5.4", label: "gpt-5.4（平衡）" },
  { value: "gpt-5.3-codex-spark", label: "gpt-5.3-codex-spark（快速）" },
] as const;
const OPENAI_REASONING_OPTIONS = [
  { value: "low", label: "低（最快）" },
  { value: "medium", label: "中（平台默认）" },
  { value: "high", label: "高（最慢但更细致）" },
] as const;

function isOpenAIReasoningModel(model: string): boolean {
  const lower = model.toLowerCase();
  return (
    lower.startsWith("gpt-5") ||
    lower.startsWith("o1") ||
    lower.startsWith("o3") ||
    lower.startsWith("o4")
  );
}

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
  const activeProvider = settings?.activeProvider ?? "cloud";
  const currentSection = useMemo(() => {
    if (!settings) {
      return null;
    }
    // 知交订阅：activation code is the only required field. Base URL is exposed
    // for self-hosters but hidden behind a details toggle so the common path
    // stays a single input.
    if (activeProvider === "cloud") {
      return (
        <>
          <label className="settings-field settings-field-wide">
            <span>激活码</span>
            <input
              aria-label="Activation code"
              placeholder="ZJ-XXXX-XXXX-XXXX"
              value={settings.cloud.activationCode}
              onChange={(event) =>
                onChange({
                  ...settings,
                  cloud: {
                    ...settings.cloud,
                    activationCode: event.target.value.trim(),
                  },
                })
              }
            />
          </label>
          <div className="settings-field settings-field-wide">
            <p className="settings-section-hint">
              知交订阅已内置模型（DeepSeek v4-flash）与 API 额度，填入激活码即可使用，无需自己申请 API key。
              点下方「测试连接」可查看本月剩余额度。
            </p>
            <details className="settings-advanced">
              <summary>高级：服务地址</summary>
              <input
                aria-label="Cloud base URL"
                value={settings.cloud.baseUrl}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    cloud: {
                      ...settings.cloud,
                      baseUrl: event.target.value,
                    },
                  })
                }
              />
            </details>
          </div>
        </>
      );
    }

    if (activeProvider === "codex") {
      return (
        <>
          <label className="settings-field settings-field-wide">
            <span>Codex 可执行文件</span>
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
            <span>模型</span>
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
            <span>推理强度</span>
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
              <option value="low">低（最快）</option>
              <option value="medium">中</option>
              <option value="high">高（最慢但更细致）</option>
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
            <span>服务名称</span>
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
          <>
            <label className="settings-field">
              <span>模型</span>
              <select
                aria-label="Model name"
                value={target.model}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onChange({
                    ...settings,
                    deepseek: {
                      ...settings.deepseek,
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
            <label className="settings-field">
              <span>思考模式</span>
              <select
                aria-label="DeepSeek thinking mode"
                value={settings.deepseek.thinkingMode}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    deepseek: {
                      ...settings.deepseek,
                      thinkingMode: event.target.value as "enabled" | "disabled",
                    },
                  })
                }
              >
                {DEEPSEEK_THINKING_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : activeProvider === "sjtu" ? (
          <label className="settings-field">
            <span>模型</span>
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
        ) : activeProvider === "openai" ? (
          <>
            <label className="settings-field">
              <span>模型</span>
              <select
                aria-label="Model name"
                value={settings.openai.model}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onChange({
                    ...settings,
                    openai: {
                      ...settings.openai,
                      model: nextValue,
                    },
                  });
                }}
              >
                {/* If the user has a saved value that isn't in the curated list
                    (e.g. legacy "gpt-4o"), surface it so the dropdown still
                    reflects current state instead of going blank. */}
                {!OPENAI_MODEL_OPTIONS.some((option) => option.value === settings.openai.model) ? (
                  <option value={settings.openai.model}>{settings.openai.model}（自定义）</option>
                ) : null}
                {OPENAI_MODEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isOpenAIReasoningModel(settings.openai.model) ? (
              <label className="settings-field">
                <span>推理强度</span>
                <select
                  aria-label="OpenAI reasoning effort"
                  value={settings.openai.reasoningEffort}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      openai: {
                        ...settings.openai,
                        reasoningEffort: event.target.value as "low" | "medium" | "high",
                      },
                    })
                  }
                >
                  {OPENAI_REASONING_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : (
          // The only remaining provider in this branch is "custom" — deepseek,
          // sjtu, and openai all have their own dedicated UI above.
          <label className="settings-field">
            <span>模型</span>
            <input
              aria-label="Model name"
              value={settings.custom.model}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange({
                  ...settings,
                  custom: {
                    ...settings.custom,
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
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="连接设置">
        <header className="settings-modal-header">
          <div>
            <p className="panel-kicker">连接</p>
            <h2>连接设置</h2>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="settings-grid">
          <label className="settings-field settings-field-wide">
            <span>服务提供方</span>
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
              {PROVIDER_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {currentSection}
        </div>

        <div className="settings-grid settings-notes-grid">
          <div className="settings-section-header">
            <p className="panel-kicker">翻译触发</p>
            <p className="settings-section-hint">
              选择什么动作会让 PDF 选区进入翻译。如果你主要靠右键加入笔记，建议改为"右键菜单"以避免误选触发请求。
            </p>
          </div>
          <label className="settings-field settings-field-wide">
            <span>触发方式</span>
            <select
              aria-label="Translation trigger"
              value={settings.preferences.translationTrigger}
              onChange={(event) =>
                onChange({
                  ...settings,
                  preferences: {
                    ...settings.preferences,
                    translationTrigger: event.target.value as "selection" | "menu",
                  },
                })
              }
            >
              <option value="selection">选中文字 → 自动翻译（推荐）</option>
              <option value="menu">必须右键 → 翻译（不会自动）</option>
            </select>
          </label>
        </div>

        <div className="settings-grid settings-notes-grid">
          <div className="settings-section-header">
            <p className="panel-kicker">PDF 批注</p>
            <p className="settings-section-hint">
              在 PDF 里高亮、写评论时使用的作者名，会显示在评论卡片上并写入 PDF 文件（WPS / Adobe 可见）。默认使用电脑用户名。
            </p>
          </div>
          <label className="settings-field settings-field-wide">
            <span>批注作者</span>
            <input
              aria-label="Annotation author"
              placeholder="你的名字"
              value={settings.annotations?.author ?? ""}
              onChange={(event) =>
                onChange({
                  ...settings,
                  annotations: {
                    ...settings.annotations,
                    author: event.target.value,
                  },
                })
              }
            />
          </label>
        </div>

        <div className="settings-grid settings-notes-grid">
          <div className="settings-section-header">
            <div className="settings-section-title-row">
              <p className="panel-kicker">Obsidian 笔记</p>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  aria-label="Enable Obsidian notes"
                  checked={settings.notes.enabled}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      notes: {
                        ...settings.notes,
                        enabled: event.target.checked,
                      },
                    })
                  }
                />
                <span>{settings.notes.enabled ? "已启用" : "未启用"}</span>
              </label>
            </div>
            <p className="settings-section-hint">
              {settings.notes.enabled
                ? "在 PDF 选区上右键可将原文（可选含译文）追加到 vault 内的 markdown 文件。跨设备同步由 Obsidian 自身负责。"
                : "默认关闭。如需把选中的段落保存进 Obsidian vault，请勾选启用并填写下方路径。"}
            </p>
          </div>
          {settings.notes.enabled ? (
            <>
              <label className="settings-field settings-field-wide">
                <span>Vault 绝对路径</span>
                <input
                  aria-label="Obsidian vault path"
                  placeholder="/Users/you/Documents/ObsidianVault"
                  value={settings.notes.vaultPath}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      notes: {
                        ...settings.notes,
                        vaultPath: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label className="settings-field">
                <span>子目录</span>
                <input
                  aria-label="Obsidian notes subdir"
                  value={settings.notes.subdir}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      notes: {
                        ...settings.notes,
                        subdir: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label className="settings-field settings-field-checkbox">
                <input
                  type="checkbox"
                  aria-label="Include timestamp"
                  checked={settings.notes.includeTimestamp}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      notes: {
                        ...settings.notes,
                        includeTimestamp: event.target.checked,
                      },
                    })
                  }
                />
                <span>包含时间戳</span>
              </label>
            </>
          ) : null}
        </div>

        <p className="settings-key-hint">
          {activeProvider === "cloud"
            ? "激活码仅保存在本机的用户配置目录。使用知交订阅时，选中的段落会发送到知交订阅服务器以调用模型；PDF 文件本身始终留在本地。"
            : "API key 与 Obsidian vault 路径仅保存在本机的用户配置目录，不会随项目同步、不会上传到任何服务器。"}
        </p>

        <footer className="settings-modal-footer">
          <div className="settings-test-result" aria-live="polite">
            {testResult}
          </div>
          <div className="settings-actions">
            <button type="button" className="secondary-button" onClick={onTest} disabled={isTesting || isSaving}>
              {isTesting ? "测试中…" : "测试连接"}
            </button>
            <button type="button" className="primary-button" onClick={onSave} disabled={isSaving}>
              {isSaving ? "保存中…" : "保存设置"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
