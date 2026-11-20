// Model choices and the names readers see, in one place so the settings
// dropdown and the header chip never disagree. Ids are what the APIs expect;
// names are what the model actually is.
import type { ProviderName } from "../types";

// DeepSeek serves its current V4.1 Flash under the id this app has always
// sent (`deepseek-v4-flash`) as well as the newer `deepseek-flash`.
export const DEEPSEEK_MODEL_OPTIONS = [
  { value: "deepseek-v4-flash", label: "V4.1 Flash（推荐 · 1M 上下文）" },
  { value: "deepseek-v4-pro", label: "V4 Pro（更强）" },
] as const;

// 交大 SJTU API (checked 2026-11-20 against its /models list): both deepseek
// ids run DeepSeek V4 Flash — `deepseek-reasoner` is the thinking variant,
// ~30s before the first word on a one-line passage. `qwen` is an alias of
// `qwen3.8-27b`.
export const SJTU_MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "V4 Flash（推荐）" },
  { value: "deepseek-reasoner", label: "V4 Flash · 深度思考（较慢）" },
  { value: "qwen3.8-27b", label: "Qwen3.8（27B）" },
] as const;

// Header-chip names. 知交订阅 calls DeepSeek too, so it shares DeepSeek's.
const DEEPSEEK_DISPLAY_NAMES: Record<string, string> = {
  "deepseek-v4-flash": "V4.1 Flash",
  "deepseek-flash": "V4.1 Flash",
  "deepseek-v4-pro": "V4 Pro",
};

const DISPLAY_NAMES: Partial<Record<ProviderName, Record<string, string>>> = {
  cloud: DEEPSEEK_DISPLAY_NAMES,
  deepseek: DEEPSEEK_DISPLAY_NAMES,
  sjtu: {
    "deepseek-chat": "V4 Flash",
    "deepseek-reasoner": "V4 Flash 思考",
    "qwen3.8-27b": "Qwen3.8（27B）",
    qwen: "Qwen3.8（27B）",
  },
};

// Qwen3 models think silently before answering unless told not to: on the
// SJTU API that was ~30s of nothing, then the answer (6s with it off).
// vLLM-style servers take the switch through chat_template_kwargs.
export function disablesQwenThinking(model: string): boolean {
  return model.toLowerCase().startsWith("qwen");
}

export function displayModelName(provider: ProviderName, model: string): string {
  if (!model) {
    return model;
  }
  const known = DISPLAY_NAMES[provider]?.[model.toLowerCase()];
  if (known) {
    return known;
  }
  // Unknown id: at least drop a redundant provider prefix to keep it short.
  if ((provider === "deepseek" || provider === "cloud") && model.toLowerCase().startsWith("deepseek-")) {
    return model.slice("deepseek-".length);
  }
  return model;
}
