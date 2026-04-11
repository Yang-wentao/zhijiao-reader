import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import OpenAI from "openai";
import type { ReasoningEffort } from "./config.js";

export type ProviderName = "openai" | "codex" | "deepseek" | "custom";

export type ConnectionSettings = {
  activeProvider: ProviderName;
  codex: {
    bin: string;
    model: string;
    reasoningEffort: ReasoningEffort;
  };
  deepseek: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  openai: {
    apiKey: string;
    model: string;
    baseUrl: string;
  };
  custom: {
    label: string;
    apiKey: string;
    model: string;
    baseUrl: string;
  };
};

type PartialConnectionSettings = Partial<ConnectionSettings> & {
  codex?: Partial<ConnectionSettings["codex"]>;
  deepseek?: Partial<ConnectionSettings["deepseek"]>;
  openai?: Partial<ConnectionSettings["openai"]>;
  custom?: Partial<ConnectionSettings["custom"]>;
};

export type ConnectionTestInput = {
  provider: ProviderName;
  codex?: Partial<ConnectionSettings["codex"]>;
  deepseek?: Partial<ConnectionSettings["deepseek"]>;
  openai?: Partial<ConnectionSettings["openai"]>;
  custom?: Partial<ConnectionSettings["custom"]>;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
};

const DEFAULT_CONNECTION_FILE = join(process.cwd(), "config", "providers.local.json");

export function buildDefaultConnectionSettings(env: NodeJS.ProcessEnv): ConnectionSettings {
  const activeProvider = normalizeProvider(env.AI_PROVIDER);
  return {
    activeProvider,
    codex: {
      bin: env.CODEX_BIN?.trim() || "codex",
      model: env.CODEX_MODEL?.trim() || "gpt-5.4-mini",
      reasoningEffort: normalizeReasoningEffort(env.CODEX_REASONING_EFFORT),
    },
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY?.trim() || "",
      model: env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
      baseUrl: env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com",
    },
    openai: {
      apiKey: env.OPENAI_API_KEY?.trim() || "",
      model: env.OPENAI_MODEL?.trim() || "gpt-4o",
      baseUrl: env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1",
    },
    custom: {
      label: env.CUSTOM_PROVIDER_LABEL?.trim() || "Custom API",
      apiKey: env.CUSTOM_API_KEY?.trim() || "",
      model: env.CUSTOM_MODEL?.trim() || "custom-model",
      baseUrl: env.CUSTOM_BASE_URL?.trim() || "https://api.openai.com/v1",
    },
  };
}

export function mergeConnectionSettings(
  defaults: ConnectionSettings,
  overrides: PartialConnectionSettings | null | undefined,
): ConnectionSettings {
  return {
    activeProvider: normalizeProvider(overrides?.activeProvider || defaults.activeProvider),
    codex: {
      bin: overrides?.codex?.bin?.trim() || defaults.codex.bin,
      model: overrides?.codex?.model?.trim() || defaults.codex.model,
      reasoningEffort: normalizeReasoningEffort(overrides?.codex?.reasoningEffort || defaults.codex.reasoningEffort),
    },
    deepseek: {
      apiKey: overrides?.deepseek?.apiKey?.trim() || defaults.deepseek.apiKey,
      model: overrides?.deepseek?.model?.trim() || defaults.deepseek.model,
      baseUrl: overrides?.deepseek?.baseUrl?.trim() || defaults.deepseek.baseUrl,
    },
    openai: {
      apiKey: overrides?.openai?.apiKey?.trim() || defaults.openai.apiKey,
      model: overrides?.openai?.model?.trim() || defaults.openai.model,
      baseUrl: overrides?.openai?.baseUrl?.trim() || defaults.openai.baseUrl,
    },
    custom: {
      label: overrides?.custom?.label?.trim() || defaults.custom.label,
      apiKey: overrides?.custom?.apiKey?.trim() || defaults.custom.apiKey,
      model: overrides?.custom?.model?.trim() || defaults.custom.model,
      baseUrl: overrides?.custom?.baseUrl?.trim() || defaults.custom.baseUrl,
    },
  };
}

export async function loadConnectionSettings(
  env: NodeJS.ProcessEnv,
  filePath = DEFAULT_CONNECTION_FILE,
): Promise<{ settings: ConnectionSettings; fileExists: boolean }> {
  const defaults = buildDefaultConnectionSettings(env);
  if (!existsSync(filePath)) {
    return { settings: defaults, fileExists: false };
  }

  const content = await readFile(filePath, "utf8");
  const parsed = JSON.parse(content) as PartialConnectionSettings;
  return {
    settings: mergeConnectionSettings(defaults, parsed),
    fileExists: true,
  };
}

export async function saveConnectionSettings(settings: ConnectionSettings, filePath = DEFAULT_CONNECTION_FILE) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export async function testConnectionSettings(input: ConnectionTestInput): Promise<ConnectionTestResult> {
  if (input.provider === "codex") {
    const binary = input.codex?.bin?.trim() || "codex";
    const result = spawnSync(binary, ["--version"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    if (result.status === 0) {
      return { ok: true, message: result.stdout.trim() || "Codex CLI is available." };
    }
    return {
      ok: false,
      message: result.stderr.trim() || `Failed to execute ${binary}.`,
    };
  }

  const config = getRemoteConfig(input);
  if (!config.apiKey) {
    return { ok: false, message: "API key is required." };
  }
  if (!config.model) {
    return { ok: false, message: "Model name is required." };
  }
  if (!config.baseUrl) {
    return { ok: false, message: "Base URL is required." };
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });

  await client.chat.completions.create({
    model: config.model,
    stream: false,
    temperature: config.model === "deepseek-reasoner" ? undefined : 0,
    messages: [{ role: "user", content: "Reply with OK." }],
    max_tokens: 8,
  });

  return { ok: true, message: "Connection succeeded." };
}

export function getConnectionSettingsFilePath() {
  return DEFAULT_CONNECTION_FILE;
}

export function buildConnectionLabel(settings: ConnectionSettings) {
  if (settings.activeProvider === "codex") {
    return `Local Codex · ${settings.codex.model} · ${settings.codex.reasoningEffort}`;
  }
  if (settings.activeProvider === "deepseek") {
    return `DeepSeek · ${settings.deepseek.model}`;
  }
  if (settings.activeProvider === "custom") {
    return `${settings.custom.label} · ${settings.custom.model}`;
  }
  return `OpenAI · ${settings.openai.model}`;
}

function normalizeProvider(provider: string | undefined | null): ProviderName {
  if (provider === "codex" || provider === "deepseek" || provider === "custom") {
    return provider;
  }
  return "openai";
}

function normalizeReasoningEffort(raw: string | undefined | null): ReasoningEffort {
  if (raw === "medium" || raw === "high") {
    return raw;
  }
  return "low";
}

function getRemoteConfig(input: ConnectionTestInput) {
  if (input.provider === "deepseek") {
    return {
      apiKey: input.deepseek?.apiKey?.trim() || "",
      model: input.deepseek?.model?.trim() || "",
      baseUrl: input.deepseek?.baseUrl?.trim() || "",
    };
  }
  if (input.provider === "custom") {
    return {
      apiKey: input.custom?.apiKey?.trim() || "",
      model: input.custom?.model?.trim() || "",
      baseUrl: input.custom?.baseUrl?.trim() || "",
    };
  }
  return {
    apiKey: input.openai?.apiKey?.trim() || "",
    model: input.openai?.model?.trim() || "",
    baseUrl: input.openai?.baseUrl?.trim() || "",
  };
}
