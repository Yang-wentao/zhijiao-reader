import "dotenv/config";
import cors from "cors";
import express from "express";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type ReasoningEffort } from "./config.js";
import { CodexProvider } from "./providers/codexProvider.js";
import { CustomProvider } from "./providers/customProvider.js";
import { DeepSeekProvider } from "./providers/deepseekProvider.js";
import { OpenAIProvider } from "./providers/openaiProvider.js";
import { SjtuProvider } from "./providers/sjtuProvider.js";
import type { AIProvider } from "./providers/types.js";
import { createAIRouter } from "./routes/ai.js";
import { createNotesRouter } from "./routes/notes.js";
import {
  buildConnectionLabel,
  buildDefaultConnectionSettings,
  loadConnectionSettings,
  saveConnectionSettings as persistConnectionSettings,
  testConnectionSettings,
  type ConnectionSettings,
  type ProviderName,
} from "./runtimeConfig.js";

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

type StartServerOptions = {
  port?: number;
  staticDir?: string | null;
};

export type StartedServer = {
  app: express.Express;
  server: Server;
  port: number;
  close: () => Promise<void>;
};

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const app = express();
  const state = await initializeRuntimeState();
  const port = options.port ?? Number(process.env.PORT ?? 8787);
  const allowedAppOrigins = createAllowedAppOrigins(port, process.env.ZHIJIAO_ALLOWED_ORIGINS);

  app.use(
    cors({
      origin(origin, callback) {
        callback(null, isAllowedAppOrigin(origin, allowedAppOrigins));
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use(
    "/api",
    createAIRouter({
      getProvider: () => getActiveRuntime(state).provider,
      getProviderName: () => state.activeProviderName,
      getProviderOptions: () => ["codex", "deepseek", "sjtu", "openai", "custom"],
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
        } else if (state.activeProviderName === "sjtu") {
          state.settings.sjtu.model = model;
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
      getNotesReady: () => state.settings.notes.vaultPath.trim().length > 0,
    }),
  );

  app.use(
    "/api/notes",
    createNotesRouter({
      getNotesSettings: () => state.settings.notes,
      isRequestOriginAllowed: (origin) => isAllowedAppOrigin(origin, allowedAppOrigins),
    }),
  );

  if (options.staticDir) {
    const resolvedStaticDir = resolve(options.staticDir);
    if (existsSync(resolvedStaticDir)) {
      app.use(express.static(resolvedStaticDir));
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) {
          next();
          return;
        }
        res.sendFile(resolve(resolvedStaticDir, "index.html"));
      });
    }
  }

  const server = createServer(app);
  await new Promise<void>((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      resolvePromise();
    });
  });

  return {
    app,
    server,
    port,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
}

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
  const sjtuReady = settings.sjtu.apiKey.length > 0 && settings.sjtu.baseUrl.length > 0 && settings.sjtu.model.length > 0;
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
    sjtu: {
      provider: sjtuReady
        ? new SjtuProvider({
            apiKey: settings.sjtu.apiKey,
            model: settings.sjtu.model,
            baseURL: settings.sjtu.baseUrl,
          })
        : createUnavailableProvider("SJTU API settings are incomplete."),
      isReady: sjtuReady,
      model: settings.sjtu.model,
      modelOptions: ["deepseek-chat", "deepseek-reasoner", "glm-5", "minimax", "minimax-m2.5", "qwen3coder"],
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

function getActiveRuntime(state: RuntimeState) {
  return state.runtimes[state.activeProviderName];
}

function buildAppConfig(state: RuntimeState) {
  const runtime = getActiveRuntime(state);
  return {
    hasApiKey: state.activeProviderName === "codex" ? false : runtime.isReady,
    isReady: runtime.isReady,
    provider: state.activeProviderName,
    providerOptions: ["codex", "deepseek", "sjtu", "openai", "custom"] satisfies ProviderName[],
    canSwitchProviders: true,
    model: runtime.model,
    modelOptions: runtime.modelOptions,
    canSwitchModels: runtime.canSwitchModels,
    reasoningEffort: runtime.reasoningEffort,
    reasoningEffortOptions: runtime.reasoningEffortOptions,
    canSwitchReasoningEffort: runtime.canSwitchReasoningEffort,
    questionActionLabel: "Ask ZhiJiao",
    maxSelectionChars: 8000,
    setupRequired: state.setupRequired || !runtime.isReady,
    connectionLabel: buildConnectionLabel(state.settings),
    notesReady: state.settings.notes.vaultPath.trim().length > 0,
  };
}

export function createAllowedAppOrigins(port: number, additionalOrigins = ""): Set<string> {
  const origins = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  for (const origin of additionalOrigins.split(",")) {
    const trimmed = origin.trim();
    if (trimmed) {
      origins.add(trimmed);
    }
  }
  return origins;
}

export function isAllowedAppOrigin(origin: string | undefined, allowedOrigins: ReadonlySet<string>): boolean {
  if (!origin) {
    return true;
  }
  return allowedOrigins.has(origin);
}

function testCodexBinary(binary: string) {
  const result = spawnSync(binary, ["--version"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.status === 0;
}

function isDirectExecution() {
  const currentFile = fileURLToPath(import.meta.url);
  const entryFile = process.argv[1] ? resolve(process.argv[1]) : "";
  return currentFile === entryFile;
}

if (isDirectExecution()) {
  void startServer().then(({ port }) => {
    console.log(`Server listening on http://127.0.0.1:${port}`);
  });
}
