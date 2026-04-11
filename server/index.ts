import "dotenv/config";
import cors from "cors";
import express from "express";
import { spawnSync } from "node:child_process";
import { type ReasoningEffort } from "./config";
import { CodexProvider } from "./providers/codexProvider";
import { CustomProvider } from "./providers/customProvider";
import { DeepSeekProvider } from "./providers/deepseekProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import type { AIProvider } from "./providers/types";
import { createAIRouter } from "./routes/ai";
import {
  buildConnectionLabel,
  buildDefaultConnectionSettings,
  loadConnectionSettings,
  saveConnectionSettings as persistConnectionSettings,
  testConnectionSettings,
  type ConnectionSettings,
  type ProviderName,
} from "./runtimeConfig";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

type ProviderRuntime = {
  provider: AIProvider;
  isReady: boolean;
  model: string;
  modelOptions: string[];
  canSwitchModels: boolean;
  reasoningEffort: ReasoningEffort | null;
  reasoningEffortOptions: ReasoningEffort[];
  canSwitchReasoningEffort: boolean;
  setModel?: (model: string) => void;
  setReasoningEffort?: (reasoningEffort: ReasoningEffort) => void;
};

type RuntimeState = {
  settings: ConnectionSettings;
  setupRequired: boolean;
  runtimes: Record<ProviderName, ProviderRuntime>;
  activeProviderName: ProviderName;
};

void bootstrap();

function createUnavailableProvider(message: string): AIProvider {
  return {
    async streamTranslation() {
      throw new Error(message);
    },
    async streamAnswer() {
      throw new Error(message);
    },
  };
}

function createProviderRuntimeMap(settings: ConnectionSettings): Record<ProviderName, ProviderRuntime> {
  const codexProvider = new CodexProvider({
    codexBin: settings.codex.bin,
    cwd: process.cwd(),
    model: settings.codex.model,
    reasoningEffort: settings.codex.reasoningEffort,
  });

  const codexReady = testCodexBinary(settings.codex.bin);
  const openaiReady = settings.openai.apiKey.length > 0;
  const deepseekReady = settings.deepseek.apiKey.length > 0;
  const customReady =
    settings.custom.apiKey.length > 0 && settings.custom.baseUrl.length > 0 && settings.custom.model.length > 0;

  return {
    codex: {
      provider: codexReady ? codexProvider : createUnavailableProvider(`Unable to execute ${settings.codex.bin}.`),
      isReady: codexReady,
      model: settings.codex.model,
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort: settings.codex.reasoningEffort,
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      setModel(nextModel: string) {
        codexProvider.setModel(nextModel);
        this.model = nextModel;
      },
      setReasoningEffort(nextEffort: ReasoningEffort) {
        codexProvider.setReasoningEffort(nextEffort);
        this.reasoningEffort = nextEffort;
      },
    },
    openai: {
      provider: openaiReady
        ? new OpenAIProvider({
            apiKey: settings.openai.apiKey,
            model: settings.openai.model,
            baseURL: settings.openai.baseUrl,
          })
        : createUnavailableProvider("OPENAI_API_KEY is missing."),
      isReady: openaiReady,
      model: settings.openai.model,
      modelOptions: [settings.openai.model],
      canSwitchModels: true,
      reasoningEffort: null,
      reasoningEffortOptions: [],
      canSwitchReasoningEffort: false,
    },
    deepseek: {
      provider: deepseekReady
        ? new DeepSeekProvider({
            apiKey: settings.deepseek.apiKey,
            model: settings.deepseek.model,
            baseURL: settings.deepseek.baseUrl,
          })
        : createUnavailableProvider("DEEPSEEK_API_KEY is missing."),
      isReady: deepseekReady,
      model: settings.deepseek.model,
      modelOptions: ["deepseek-chat", "deepseek-reasoner"],
      canSwitchModels: true,
      reasoningEffort: null,
      reasoningEffortOptions: [],
      canSwitchReasoningEffort: false,
    },
    custom: {
      provider: customReady
        ? new CustomProvider({
            apiKey: settings.custom.apiKey,
            model: settings.custom.model,
            baseURL: settings.custom.baseUrl,
          })
        : createUnavailableProvider("Custom API settings are incomplete."),
      isReady: customReady,
      model: settings.custom.model,
      modelOptions: [settings.custom.model],
      canSwitchModels: true,
      reasoningEffort: null,
      reasoningEffortOptions: [],
      canSwitchReasoningEffort: false,
    },
  };
}

async function initializeRuntimeState(): Promise<RuntimeState> {
  const defaults = buildDefaultConnectionSettings(process.env);
  const { settings, fileExists } = await loadConnectionSettings(process.env);
  return {
    settings,
    setupRequired: !fileExists,
    runtimes: createProviderRuntimeMap(settings),
    activeProviderName: settings.activeProvider || defaults.activeProvider,
  };
}

function testCodexBinary(binary: string) {
  const result = spawnSync(binary, ["--version"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.status === 0;
}

async function bootstrap() {
  const state: RuntimeState = await initializeRuntimeState();

  app.use(
    "/api",
    createAIRouter({
      getProvider: () => getActiveRuntime(state).provider,
      getProviderName: () => state.activeProviderName,
      getProviderOptions: () => ["codex", "deepseek", "openai", "custom"],
      getCanSwitchProviders: () => true,
      getIsReady: () => getActiveRuntime(state).isReady,
      getModel: () => getActiveRuntime(state).model,
      getModelOptions: () => getActiveRuntime(state).modelOptions,
      getCanSwitchModels: () => getActiveRuntime(state).canSwitchModels,
      getReasoningEffort: () => getActiveRuntime(state).reasoningEffort,
      getReasoningEffortOptions: () => getActiveRuntime(state).reasoningEffortOptions,
      getCanSwitchReasoningEffort: () => getActiveRuntime(state).canSwitchReasoningEffort,
      getSetupRequired: () => buildAppConfig(state).setupRequired,
      getConnectionLabel: () => buildConnectionLabel(state.settings),
      getConnectionSettings: () => state.settings,
      saveConnectionSettings: async (settings) => {
        state.settings = settings;
        state.runtimes = createProviderRuntimeMap(settings);
        state.activeProviderName = settings.activeProvider;
        state.setupRequired = false;
        await persistConnectionSettings(settings);
      },
      testConnectionSettings,
      setProvider: (providerName) => {
        state.activeProviderName = providerName;
        state.settings.activeProvider = providerName;
      },
      setModel: (model) => {
        const runtime = getActiveRuntime(state);
        runtime.setModel?.(model);
        if (state.activeProviderName === "codex") {
          state.settings.codex.model = model;
        } else if (state.activeProviderName === "deepseek") {
          state.settings.deepseek.model = model;
        } else if (state.activeProviderName === "custom") {
          state.settings.custom.model = model;
        } else {
          state.settings.openai.model = model;
        }
      },
      setReasoningEffort: (reasoningEffort) => {
        getActiveRuntime(state).setReasoningEffort?.(reasoningEffort);
        if (state.activeProviderName === "codex") {
          state.settings.codex.reasoningEffort = reasoningEffort;
        }
      },
    }),
  );

  app.listen(Number(process.env.PORT ?? 8787), () => {
    console.log(`Server listening on http://localhost:${process.env.PORT ?? 8787}`);
  });
}

function getActiveRuntime(state: RuntimeState) {
  return state.runtimes[state.activeProviderName];
}

function buildAppConfig(state: RuntimeState) {
  const runtime = getActiveRuntime(state);
  return {
    hasApiKey: state.activeProviderName === "codex" ? false : runtime.isReady,
    isReady: runtime.isReady,
    provider: state.activeProviderName,
    providerOptions: ["codex", "deepseek", "openai", "custom"] satisfies ProviderName[],
    canSwitchProviders: true,
    model: runtime.model,
    modelOptions: runtime.modelOptions,
    canSwitchModels: runtime.canSwitchModels,
    reasoningEffort: runtime.reasoningEffort,
    reasoningEffortOptions: runtime.reasoningEffortOptions,
    canSwitchReasoningEffort: runtime.canSwitchReasoningEffort,
    questionActionLabel: "Ask Codex",
    maxSelectionChars: 8000,
    setupRequired: state.setupRequired || !runtime.isReady,
    connectionLabel: buildConnectionLabel(state.settings),
  };
}
