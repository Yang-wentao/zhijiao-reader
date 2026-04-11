import "dotenv/config";
import cors from "cors";
import express from "express";
import { getServerConfig, requireApiKey, type ProviderName, type ReasoningEffort } from "./config";
import { CodexProvider } from "./providers/codexProvider";
import { DeepSeekProvider } from "./providers/deepseekProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import type { AIProvider } from "./providers/types";
import { createAIRouter } from "./routes/ai";

const config = getServerConfig();
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

const runtimes: Record<ProviderName, ProviderRuntime> = {
  codex: (() => {
    const provider = new CodexProvider({
      codexBin: config.codexBin,
      cwd: process.cwd(),
      model: config.provider === "codex" ? config.model : "gpt-5.4-mini",
      reasoningEffort: config.provider === "codex" ? config.reasoningEffort ?? "low" : "low",
    });
    let model = config.provider === "codex" ? config.model : "gpt-5.4-mini";
    let reasoningEffort = config.provider === "codex" ? config.reasoningEffort ?? "low" : "low";
    return {
      provider,
      isReady: true,
      model,
      modelOptions: ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark"],
      canSwitchModels: true,
      reasoningEffort,
      reasoningEffortOptions: ["low", "medium", "high"],
      canSwitchReasoningEffort: true,
      setModel(nextModel: string) {
        provider.setModel(nextModel);
        this.model = nextModel;
        model = nextModel;
      },
      setReasoningEffort(nextEffort: ReasoningEffort) {
        provider.setReasoningEffort(nextEffort);
        this.reasoningEffort = nextEffort;
        reasoningEffort = nextEffort;
      },
    };
  })(),
  openai: (() => {
    const isReady = config.openAIApiKey.length > 0;
    const provider = isReady
      ? new OpenAIProvider({
          apiKey: requireApiKey({ ...config, hasApiKey: true }),
          model: config.provider === "openai" ? config.model : process.env.OPENAI_MODEL?.trim() || "gpt-4o",
        })
      : createUnavailableProvider("OPENAI_API_KEY is missing.");
    return {
      provider,
      isReady,
      model: config.provider === "openai" ? config.model : process.env.OPENAI_MODEL?.trim() || "gpt-4o",
      modelOptions:
        process.env.OPENAI_MODEL_OPTIONS?.split(",").map((item) => item.trim()).filter(Boolean) ||
        ["gpt-4o", "gpt-4o-mini"],
      canSwitchModels: true,
      reasoningEffort: null,
      reasoningEffortOptions: [],
      canSwitchReasoningEffort: false,
      setModel(nextModel: string) {
        this.model = nextModel;
        if (provider instanceof OpenAIProvider) {
          provider.setModel(nextModel);
        }
      },
    };
  })(),
  deepseek: (() => {
    const isReady = config.deepSeekApiKey.length > 0;
    const initialModel = config.provider === "deepseek" ? config.model : process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
    const provider = isReady
      ? new DeepSeekProvider({
          apiKey: config.deepSeekApiKey,
          model: initialModel,
        })
      : createUnavailableProvider("DEEPSEEK_API_KEY is missing.");
    return {
      provider,
      isReady,
      model: initialModel,
      modelOptions:
        process.env.DEEPSEEK_MODEL_OPTIONS?.split(",").map((item) => item.trim()).filter(Boolean) ||
        ["deepseek-chat", "deepseek-reasoner"],
      canSwitchModels: true,
      reasoningEffort: null,
      reasoningEffortOptions: [],
      canSwitchReasoningEffort: false,
      setModel(nextModel: string) {
        this.model = nextModel;
        if (provider instanceof DeepSeekProvider) {
          provider.setModel(nextModel);
        }
      },
    };
  })(),
};

let activeProviderName: ProviderName = config.provider;

function getActiveRuntime() {
  return runtimes[activeProviderName];
}

app.use(
  "/api",
  createAIRouter({
    getProvider: () => getActiveRuntime().provider,
    getProviderName: () => activeProviderName,
    getProviderOptions: () => config.providerOptions,
    getCanSwitchProviders: () => config.canSwitchProviders,
    getIsReady: () => getActiveRuntime().isReady,
    getModel: () => getActiveRuntime().model,
    getModelOptions: () => getActiveRuntime().modelOptions,
    getCanSwitchModels: () => getActiveRuntime().canSwitchModels,
    getReasoningEffort: () => getActiveRuntime().reasoningEffort,
    getReasoningEffortOptions: () => getActiveRuntime().reasoningEffortOptions,
    getCanSwitchReasoningEffort: () => getActiveRuntime().canSwitchReasoningEffort,
    setProvider: (providerName) => {
      activeProviderName = providerName;
    },
    setModel: (model) => {
      getActiveRuntime().setModel?.(model);
    },
    setReasoningEffort: (reasoningEffort) => {
      getActiveRuntime().setReasoningEffort?.(reasoningEffort);
    },
  }),
);

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
