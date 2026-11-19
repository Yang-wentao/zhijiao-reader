// 网页版 implementations behind the api.ts surface. The web build has no
// local Express server: settings live in this browser's localStorage, and AI
// calls go straight to the 知交订阅 gateway on the SAME origin — the gateway
// (cloud/server.mjs) serves /app/ and /v1/* from one process, so no CORS is
// involved. In dev (`npm run dev:web`) Vite proxies /v1 to the production
// gateway instead.
//
// Besides 知交订阅 (the default), the web offers two bring-your-own-key
// providers — DeepSeek and 交大 SJTU API — that the browser calls directly
// (see byok.ts). The other desktop providers stay desktop-only.
import {
  BYOK_BASE_URLS,
  testByokConnection,
  type ByokProvider,
  type ByokTarget,
} from "./byok";
import type {
  AppConfig,
  CloudBalance,
  ConnectionSettings,
  ConnectionTestResult,
} from "../types";

const WEB_SETTINGS_STORAGE_KEY = "zhijiao-web-settings";

// Fallback shown before the gateway has reported its real model (/v1/me).
export const WEB_DEFAULT_MODEL = "deepseek-v4-flash";

export type WebProvider = "cloud" | ByokProvider;

// The subset of ConnectionSettings the web build actually persists.
export type WebSettings = {
  activeProvider: WebProvider;
  activationCode: string;
  deepseek: { apiKey: string; model: string; thinkingMode: "enabled" | "disabled" };
  sjtu: { apiKey: string; model: string };
  translationTrigger: "selection" | "menu";
  annotationAuthor: string;
};

export function defaultWebSettings(): WebSettings {
  return {
    activeProvider: "cloud",
    activationCode: "",
    deepseek: { apiKey: "", model: "deepseek-v4-flash", thinkingMode: "disabled" },
    sjtu: { apiKey: "", model: "deepseek-chat" },
    translationTrigger: "selection",
    annotationAuthor: "",
  };
}

function isWebProvider(value: unknown): value is WebProvider {
  return value === "cloud" || value === "deepseek" || value === "sjtu";
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

export function loadWebSettings(): WebSettings {
  try {
    const defaults = defaultWebSettings();
    const raw = window.localStorage.getItem(WEB_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    // Settings saved before the BYOK providers existed have no provider
    // fields at all; they load as 知交订阅 with their code intact.
    const parsed = JSON.parse(raw) as Partial<WebSettings>;
    const deepseek: Partial<WebSettings["deepseek"]> = parsed.deepseek ?? {};
    const sjtu: Partial<WebSettings["sjtu"]> = parsed.sjtu ?? {};
    return {
      activeProvider: isWebProvider(parsed.activeProvider) ? parsed.activeProvider : "cloud",
      activationCode:
        typeof parsed.activationCode === "string" ? parsed.activationCode : "",
      deepseek: {
        apiKey: stringOr(deepseek.apiKey, ""),
        model: stringOr(deepseek.model, defaults.deepseek.model),
        thinkingMode: deepseek.thinkingMode === "enabled" ? "enabled" : "disabled",
      },
      sjtu: {
        apiKey: stringOr(sjtu.apiKey, ""),
        model: stringOr(sjtu.model, defaults.sjtu.model),
      },
      translationTrigger:
        parsed.translationTrigger === "menu" ? "menu" : "selection",
      annotationAuthor:
        typeof parsed.annotationAuthor === "string" ? parsed.annotationAuthor : "",
    };
  } catch {
    // Private mode / corrupted JSON — behave like a fresh visit.
    return defaultWebSettings();
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

// The BYOK provider the reader has selected, or null for 知交订阅.
export function webByokTarget(web: WebSettings): ByokTarget | null {
  if (web.activeProvider === "deepseek") {
    return { provider: "deepseek", ...web.deepseek };
  }
  if (web.activeProvider === "sjtu") {
    return { provider: "sjtu", ...web.sjtu };
  }
  return null;
}

// Expand the persisted subset into a full ConnectionSettings so the existing
// settings modal (a controlled component over the whole object) works
// unchanged. The codex / openai / custom sections are never shown on the web;
// their values are inert placeholders.
export function buildWebConnectionSettings(web: WebSettings): ConnectionSettings {
  return {
    activeProvider: web.activeProvider,
    cloud: { activationCode: web.activationCode, baseUrl: "" },
    codex: { bin: "codex", model: "gpt-5.4-mini", reasoningEffort: "low" },
    deepseek: { ...web.deepseek, baseUrl: BYOK_BASE_URLS.deepseek },
    sjtu: { ...web.sjtu, baseUrl: BYOK_BASE_URLS.sjtu },
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
  const byok = webByokTarget(web);
  const hasCode = (byok ? byok.apiKey : web.activationCode).trim().length > 0;
  const model = byok ? byok.model : balance?.model || WEB_DEFAULT_MODEL;
  const providerName = byok ? (byok.provider === "deepseek" ? "DeepSeek" : "SJTU API") : "知交订阅";
  return {
    hasApiKey: hasCode,
    isReady: hasCode,
    provider: web.activeProvider,
    providerOptions: ["cloud", "deepseek", "sjtu"],
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
    connectionLabel: `${providerName} · ${model}`,
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
  const balance =
    web.activeProvider === "cloud" ? await webFetchCloudBalance(web.activationCode) : null;
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
  const byok = webByokTarget(webSettingsFrom(settings));
  if (byok) {
    return testByokConnection(byok);
  }
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

// The modal edits a full ConnectionSettings; keep only what the web uses.
function webSettingsFrom(settings: ConnectionSettings): WebSettings {
  return {
    activeProvider: isWebProvider(settings.activeProvider) ? settings.activeProvider : "cloud",
    activationCode: settings.cloud.activationCode.trim(),
    deepseek: {
      apiKey: settings.deepseek.apiKey.trim(),
      model: settings.deepseek.model,
      thinkingMode: settings.deepseek.thinkingMode === "enabled" ? "enabled" : "disabled",
    },
    sjtu: { apiKey: settings.sjtu.apiKey.trim(), model: settings.sjtu.model },
    translationTrigger: settings.preferences.translationTrigger,
    annotationAuthor: settings.annotations?.author ?? "",
  };
}

export async function webSaveConnectionSettings(
  settings: ConnectionSettings,
): Promise<AppConfig> {
  const web = webSettingsFrom(settings);
  saveWebSettings(web);
  const balance =
    web.activeProvider === "cloud" ? await webFetchCloudBalance(web.activationCode) : null;
  return buildWebAppConfig(web, balance);
}

export type PublicTrialCode = {
  code: string;
  expiresAt: string | null;
};

// The gateway's current 公开试用码 (GET /v1/public-code — no auth). Null when
// none is on offer or the gateway can't be reached; either way the settings
// screen simply doesn't show the box.
export async function webFetchPublicCode(): Promise<PublicTrialCode | null> {
  try {
    const response = await fetch("/v1/public-code", { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { code?: unknown; expiresAt?: unknown };
    if (typeof body.code !== "string" || !body.code) {
      return null;
    }
    return {
      code: body.code,
      expiresAt: typeof body.expiresAt === "string" && body.expiresAt ? body.expiresAt : null,
    };
  } catch {
    return null;
  }
}

// "10月31日 15:20" in the reader's own time zone.
export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
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
