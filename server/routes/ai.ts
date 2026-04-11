import { Router, type Response } from "express";
import type { ProviderName } from "../config.js";
import type { AIProvider, AskInput, TranslationInput } from "../providers/types.js";
import type { ConnectionSettings, ConnectionTestInput, ConnectionTestResult } from "../runtimeConfig.js";

type RouteOptions = {
  getProvider: () => AIProvider;
  getProviderName: () => ProviderName;
  getProviderOptions: () => ProviderName[];
  getCanSwitchProviders: () => boolean;
  getIsReady: () => boolean;
  getModel: () => string;
  getModelOptions: () => string[];
  getCanSwitchModels: () => boolean;
  getReasoningEffort: () => "low" | "medium" | "high" | null;
  getReasoningEffortOptions: () => Array<"low" | "medium" | "high">;
  getCanSwitchReasoningEffort: () => boolean;
  getSetupRequired: () => boolean;
  getConnectionLabel: () => string;
  getConnectionSettings: () => ConnectionSettings;
  saveConnectionSettings: (settings: ConnectionSettings) => Promise<void>;
  testConnectionSettings: (input: ConnectionTestInput) => Promise<ConnectionTestResult>;
  setProvider?: (provider: ProviderName) => void;
  setModel?: (model: string) => void;
  setReasoningEffort?: (reasoningEffort: "low" | "medium" | "high") => void;
};

const MAX_SELECTION_CHARS = 8000;

export function createAIRouter(options: RouteOptions) {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json(buildConfigResponse(options));
  });

  router.get("/connection", (_req, res) => {
    res.json(options.getConnectionSettings());
  });

  router.post("/connection/test", async (req, res) => {
    try {
      const result = await options.testConnectionSettings(req.body as ConnectionTestInput);
      res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection test failed.";
      res.status(400).json({ ok: false, message });
    }
  });

  router.post("/connection", async (req, res) => {
    const body = req.body as ConnectionSettings | undefined;
    if (!body) {
      res.status(400).json({ error: "Connection settings are required." });
      return;
    }
    await options.saveConnectionSettings(body);
    if (options.setProvider) {
      options.setProvider(body.activeProvider);
    }
    res.json(buildConfigResponse(options));
  });

  router.post("/model", (req, res) => {
    const nextProvider = typeof req.body?.provider === "string" ? req.body.provider.trim() : "";
    const nextModel = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    const nextReasoningEffort = typeof req.body?.reasoningEffort === "string" ? req.body.reasoningEffort.trim() : "";

    if (!nextProvider && !nextModel && !nextReasoningEffort) {
      res.status(400).json({ error: "No provider, model, or reasoning effort was provided." });
      return;
    }

    if (nextProvider) {
      if (!options.getCanSwitchProviders() || !options.setProvider) {
        res.status(400).json({ error: "Provider switching is not available." });
        return;
      }
      if (!options.getProviderOptions().includes(nextProvider as ProviderName)) {
        res.status(400).json({ error: "Unsupported provider selection." });
        return;
      }
      options.setProvider(nextProvider as ProviderName);
    }

    if (nextModel) {
      if (!options.getCanSwitchModels() || !options.setModel) {
        res.status(400).json({ error: "Model switching is not available for the current provider." });
        return;
      }
      if (!options.getModelOptions().includes(nextModel)) {
        res.status(400).json({ error: "Unsupported model selection." });
        return;
      }
      options.setModel(nextModel);
    }

    if (nextReasoningEffort) {
      if (!options.getCanSwitchReasoningEffort() || !options.setReasoningEffort) {
        res.status(400).json({ error: "Reasoning effort switching is not available for the current provider." });
        return;
      }
      if (!options.getReasoningEffortOptions().includes(nextReasoningEffort as "low" | "medium" | "high")) {
        res.status(400).json({ error: "Unsupported reasoning effort selection." });
        return;
      }
      options.setReasoningEffort(nextReasoningEffort as "low" | "medium" | "high");
    }

    res.json(buildConfigResponse(options));
  });

  router.post("/translate/stream", async (req, res) => {
    const body = req.body as TranslationInput | undefined;
    if (!options.getIsReady()) {
      res
        .status(503)
        .json({ error: getProviderErrorMessage(options.getProviderName()) });
      return;
    }
    const selectionText = body?.selectionText?.trim() ?? "";
    if (!selectionText) {
      res.status(400).json({ error: "No selected text provided." });
      return;
    }
    if (selectionText.length > MAX_SELECTION_CHARS) {
      res.status(400).json({ error: "Selected text is too long. Please select a shorter passage." });
      return;
    }
    await streamSse(res, options.getProvider().streamTranslation({ selectionText, pageNumber: body?.pageNumber ?? null }));
  });

  router.post("/ask/stream", async (req, res) => {
    const body = req.body as AskInput | undefined;
    if (!options.getIsReady()) {
      res
        .status(503)
        .json({ error: getProviderErrorMessage(options.getProviderName()) });
      return;
    }
    const selectionText = body?.selectionText?.trim() ?? "";
    const question = body?.question?.trim() ?? "";
    if (!selectionText || !question) {
      res.status(400).json({ error: "Selection text and question are required." });
      return;
    }
    if (selectionText.length > MAX_SELECTION_CHARS) {
      res.status(400).json({ error: "Selected text is too long. Please select a shorter passage." });
      return;
    }
    await streamSse(
      res,
      options.getProvider().streamAnswer({
        selectionText,
        pageNumber: body?.pageNumber ?? null,
        question,
        history: body?.history ?? [],
      }),
    );
  });

  return router;
}

function buildConfigResponse(options: RouteOptions) {
  return {
    hasApiKey: options.getProviderName() === "codex" ? false : options.getIsReady(),
    isReady: options.getIsReady(),
    provider: options.getProviderName(),
    providerOptions: options.getProviderOptions(),
    canSwitchProviders: options.getCanSwitchProviders(),
    model: options.getModel(),
    modelOptions: options.getModelOptions(),
    canSwitchModels: options.getCanSwitchModels(),
    reasoningEffort: options.getReasoningEffort(),
    reasoningEffortOptions: options.getReasoningEffortOptions(),
    canSwitchReasoningEffort: options.getCanSwitchReasoningEffort(),
    questionActionLabel: "Ask Codex",
    maxSelectionChars: MAX_SELECTION_CHARS,
    setupRequired: options.getSetupRequired(),
    connectionLabel: options.getConnectionLabel(),
  };
}

function getProviderErrorMessage(providerName: ProviderName) {
  if (providerName === "openai") {
    return "OPENAI_API_KEY is missing.";
  }
  if (providerName === "deepseek") {
    return "DEEPSEEK_API_KEY is missing.";
  }
  if (providerName === "custom") {
    return "Custom API credentials are missing.";
  }
  return "Provider is not ready.";
}

async function streamSse(res: Response, iterablePromise: Promise<AsyncIterable<string>>) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  try {
    const iterable = await iterablePromise;
    for await (const chunk of iterable) {
      res.write(`event: delta\n`);
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }
    res.write(`event: done\n`);
    res.write(`data: ${JSON.stringify({ ok: true })}\n\n`);
    res.end();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI error";
    res.write(`event: error\n`);
    res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
    res.end();
  }
}
