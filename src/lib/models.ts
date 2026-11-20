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

export const SJTU_MODEL_OPTIONS = [
  { value: "deepseek-chat", label: "deepseek-chat（推荐）" },
  { value: "deepseek-reasoner", label: "deepseek-reasoner" },
  { value: "glm-5", label: "glm-5" },
  { value: "minimax-m2.5", label: "minimax-m2.5" },
  { value: "qwen3coder", label: "qwen3coder" },
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
};

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
