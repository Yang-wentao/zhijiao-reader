export type ReasoningEffort = "low" | "medium" | "high";
export type ProviderName = "openai" | "codex" | "deepseek" | "sjtu" | "custom";

const DEFAULT_CODEX_MODEL = "gpt-5.4-mini";
const DEFAULT_CODEX_REASONING_EFFORT: ReasoningEffort = "low";
const DEFAULT_CODEX_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"];
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_DEEPSEEK_MODEL_OPTIONS = ["deepseek-chat", "deepseek-reasoner"];
const DEFAULT_SJTU_MODEL = "deepseek-chat";
const DEFAULT_SJTU_MODEL_OPTIONS = ["deepseek-chat", "deepseek-reasoner"];
const DEFAULT_REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["low", "medium", "high"];

export type ServerConfig = {
  provider: ProviderName;
  openAIApiKey: string;
  deepSeekApiKey: string;
  hasApiKey: boolean;
  model: string;
  modelOptions: string[];
  canSwitchModels: boolean;
  reasoningEffort: ReasoningEffort | null;
  reasoningEffortOptions: ReasoningEffort[];
  canSwitchReasoningEffort: boolean;
  providerOptions: ProviderName[];
  canSwitchProviders: boolean;
  port: number;
  codexBin: string;
};

export function getServerConfig(): ServerConfig {
  const openAIApiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  const sjtuApiKey = process.env.SJTU_API_KEY?.trim() ?? "";
  const provider = getProvider(process.env.AI_PROVIDER);
  const model = getProviderModel(provider);
  const modelOptions = getProviderModelOptions(provider, model);
  const reasoningEffort = provider === "codex" ? getCodexReasoningEffort() : null;
  return {
    provider,
    openAIApiKey,
    deepSeekApiKey,
    hasApiKey:
      provider === "deepseek"
        ? deepSeekApiKey.length > 0
        : provider === "sjtu"
          ? sjtuApiKey.length > 0
          : openAIApiKey.length > 0,
    model,
    modelOptions,
    canSwitchModels: modelOptions.length > 1,
    reasoningEffort,
    reasoningEffortOptions: provider === "codex" ? DEFAULT_REASONING_EFFORT_OPTIONS : [],
    canSwitchReasoningEffort: provider === "codex",
    providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"],
    canSwitchProviders: true,
    port: Number(process.env.PORT ?? 8787),
    codexBin: process.env.CODEX_BIN?.trim() || "codex",
  };
}


function parseModelOptions(raw: string | undefined, fallbackModel: string, defaults: string[] = []) {
  const parsed = (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const options = parsed.length > 0 ? parsed : [fallbackModel, ...defaults];
  return Array.from(new Set(options));
}

function getProvider(rawProvider: string | undefined): ProviderName {
  const normalized = rawProvider?.trim();
  if (normalized === "codex" || normalized === "deepseek" || normalized === "sjtu" || normalized === "custom") {
    return normalized;
  }
  return "openai";
}

function getProviderModel(provider: ProviderName) {
  if (provider === "codex") {
    return getCodexModel();
  }
  if (provider === "deepseek") {
    return process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_DEEPSEEK_MODEL;
  }
  if (provider === "sjtu") {
    return process.env.SJTU_MODEL?.trim() || DEFAULT_SJTU_MODEL;
  }
  if (provider === "custom") {
    return process.env.CUSTOM_MODEL?.trim() || "custom-model";
  }
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o";
}

function getProviderModelOptions(provider: ProviderName, model: string) {
  if (provider === "codex") {
    return parseModelOptions(process.env.CODEX_MODEL_OPTIONS, model, DEFAULT_CODEX_MODEL_OPTIONS);
  }
  if (provider === "deepseek") {
    return parseModelOptions(process.env.DEEPSEEK_MODEL_OPTIONS, model, DEFAULT_DEEPSEEK_MODEL_OPTIONS);
  }
  if (provider === "sjtu") {
    return parseModelOptions(process.env.SJTU_MODEL_OPTIONS, model, DEFAULT_SJTU_MODEL_OPTIONS);
  }
  if (provider === "custom") {
    return parseModelOptions(process.env.CUSTOM_MODEL_OPTIONS, model);
  }
  return parseModelOptions(process.env.OPENAI_MODEL_OPTIONS, model);
}

function getCodexModel() {
  const envModel = process.env.CODEX_MODEL?.trim();
  if (envModel) {
    return envModel;
  }
  return DEFAULT_CODEX_MODEL;
}

function getCodexReasoningEffort() {
  const raw = process.env.CODEX_REASONING_EFFORT?.trim();
  if (raw === "low" || raw === "medium" || raw === "high") {
    return raw;
  }
  return DEFAULT_CODEX_REASONING_EFFORT;
}
