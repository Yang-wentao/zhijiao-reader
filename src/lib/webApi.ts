// 网页版 implementations behind the api.ts surface. The web build has no
// local Express server: settings live in this browser's localStorage, and AI
// calls go straight to the 知交订阅 gateway on the SAME origin — the gateway
// (cloud/server.mjs) serves /app/ and /v1/* from one process, so no CORS is
// involved. In dev (`npm run dev:web`) Vite proxies /v1 to the production
// gateway instead.
//
// Only the cloud provider exists on the web: BYOK providers would need the
// prompts client-side (a fourth synced copy) and CORS to arbitrary hosts, so
// they stay desktop-only.
import type {
  AppConfig,
  CloudBalance,
  ConnectionSettings,
  ConnectionTestResult,
} from "../types";

const WEB_SETTINGS_STORAGE_KEY = "zhijiao-web-settings";

// Fallback shown before the gateway has reported its real model (/v1/me).
export const WEB_DEFAULT_MODEL = "deepseek-v4-flash";

// The subset of ConnectionSettings the web build actually persists.
export type WebSettings = {
  activationCode: string;
  translationTrigger: "selection" | "menu";
  annotationAuthor: string;
};

const DEFAULT_WEB_SETTINGS: WebSettings = {
  activationCode: "",
  translationTrigger: "selection",
  annotationAuthor: "",
};

export function loadWebSettings(): WebSettings {
  try {
    const raw = window.localStorage.getItem(WEB_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_WEB_SETTINGS };
    }
    const parsed = JSON.parse(raw) as Partial<WebSettings>;
    return {
      activationCode:
        typeof parsed.activationCode === "string" ? parsed.activationCode : "",
      translationTrigger:
        parsed.translationTrigger === "menu" ? "menu" : "selection",
      annotationAuthor:
        typeof parsed.annotationAuthor === "string" ? parsed.annotationAuthor : "",
    };
  } catch {
    // Private mode / corrupted JSON — behave like a fresh visit.
    return { ...DEFAULT_WEB_SETTINGS };
  }
}

export function saveWebSettings(settings: WebSettings): void {
  try {
    window.localStorage.setItem(WEB_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode: settings survive only until the tab closes. The in-memory
    // React state still has them, so the session keeps working.
  }
}

// Expand the persisted subset into a full ConnectionSettings so the existing
// settings modal (a controlled component over the whole object) works
// unchanged. The BYOK sections are never shown on the web; their values are
// inert placeholders.
export function buildWebConnectionSettings(web: WebSettings): ConnectionSettings {
  return {
    activeProvider: "cloud",
    cloud: { activationCode: web.activationCode, baseUrl: "" },
    codex: { bin: "codex", model: "gpt-5.4-mini", reasoningEffort: "low" },
    deepseek: {
      apiKey: "",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      thinkingMode: "disabled",
    },
    sjtu: { apiKey: "", model: "deepseek-chat", baseUrl: "" },
    openai: {
      apiKey: "",
      model: "gpt-5.4",
      baseUrl: "https://api.openai.com/v1",
      reasoningEffort: "medium",
    },
    custom: { label: "Custom API", apiKey: "", model: "", baseUrl: "" },
    notes: { enabled: false, vaultPath: "", subdir: "", includeTimestamp: false },
    preferences: { translationTrigger: web.translationTrigger },
    annotations: { author: web.annotationAuthor },
  };
}

// The web counterpart of the server's buildConfigResponse: constructed
// locally because there is no /api/config. `balance` (from /v1/me) supplies
// the gateway's real model name when available.
export function buildWebAppConfig(
  web: WebSettings,
  balance: CloudBalance | null,
): AppConfig {
  const hasCode = web.activationCode.trim().length > 0;
  const model = balance?.model || WEB_DEFAULT_MODEL;
  return {
    hasApiKey: hasCode,
    isReady: hasCode,
    provider: "cloud",
    providerOptions: ["cloud"],
    canSwitchProviders: false,
    model,
    modelOptions: [model],
    canSwitchModels: false,
    reasoningEffort: null,
    reasoningEffortOptions: [],
    canSwitchReasoningEffort: false,
    questionActionLabel: "Ask ZhiJiao",
    maxSelectionChars: 8000,
    setupRequired: !hasCode,
    connectionLabel: `知交订阅 · ${model}`,
    notesReady: false,
    translationTrigger: web.translationTrigger,
    annotationAuthor: web.annotationAuthor,
  };
}

export function webAuthHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${loadWebSettings().activationCode.trim()}` };
}

export async function webFetchCloudBalance(
  code = loadWebSettings().activationCode,
): Promise<CloudBalance | null> {
  const trimmed = code.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const response = await fetch("/v1/me", {
      headers: { Authorization: `Bearer ${trimmed}` },
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as CloudBalance;
  } catch {
    return null;
  }
}

export async function webFetchAppConfig(): Promise<AppConfig> {
  const web = loadWebSettings();
  const balance = await webFetchCloudBalance(web.activationCode);
  return buildWebAppConfig(web, balance);
}

export async function webFetchConnectionSettings(): Promise<ConnectionSettings> {
  return buildWebConnectionSettings(loadWebSettings());
}

// Mirrors the wording of the desktop server's cloud connection test
// (server/runtimeConfig.ts testConnectionSettings) so both builds report
// quota the same way.
export async function webTestConnectionSettings(
  settings: ConnectionSettings,
): Promise<ConnectionTestResult> {
  const code = settings.cloud.activationCode.trim();
  if (!code) {
    return { ok: false, message: "请填写订阅码。" };
  }
  try {
    const response = await fetch("/v1/me", {
      headers: { Authorization: `Bearer ${code}` },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      return { ok: false, message: body?.error ?? "无法连接知交订阅。" };
    }
    const balance = (await response.json()) as CloudBalance;
    const owner = balance.label ? `${balance.label} · ` : "";
    return {
      ok: true,
      message: `连接成功：${owner}本月剩余 ${formatTokenCount(balance.remainingTokens)} tokens（共 ${formatTokenCount(balance.quotaTokens)}）`,
    };
  } catch {
    return { ok: false, message: "无法连接知交订阅，请检查网络后重试。" };
  }
}

export async function webSaveConnectionSettings(
  settings: ConnectionSettings,
): Promise<AppConfig> {
  const web: WebSettings = {
    activationCode: settings.cloud.activationCode.trim(),
    translationTrigger: settings.preferences.translationTrigger,
    annotationAuthor: settings.annotations?.author ?? "",
  };
  saveWebSettings(web);
  const balance = await webFetchCloudBalance(web.activationCode);
  return buildWebAppConfig(web, balance);
}

// Same rounding as the server's formatTokenCount (cloud/ and desktop agree).
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}
