import { Router, type Response } from "express";
import type { ProviderName } from "../config.js";
import { fetchCloudBalance } from "../providers/cloudProvider.js";
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
  getNotesReady?: () => boolean;
  getTranslationTrigger?: () => "selection" | "menu";
  getAnnotationAuthor?: () => string;
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

  // Quota/usage for the saved 知交订阅 activation code, used by the header chip.
  // Returns 400 when no code is configured so the client can stay quiet.
  router.get("/cloud/balance", async (_req, res) => {
    const cloud = options.getConnectionSettings().cloud;
    if (!cloud?.activationCode?.trim()) {
      res.status(400).json({ error: "还没有填写知交订阅订阅码。" });
      return;
    }
    try {
      const balance = await fetchCloudBalance(cloud.activationCode, cloud.baseUrl);
      res.json(balance);
    } catch (error) {
      res.status(502).json({
        error: error instanceof Error ? error.message : "无法获取知交订阅余额。",
      });
    }
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
      res.status(400).json({ error: "没有收到选中的文字。" });
      return;
    }
    if (selectionText.length > MAX_SELECTION_CHARS) {
      res.status(400).json({ error: "选中的文字太长了，请缩短后再试。" });
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
      res.status(400).json({ error: "缺少选中的文字或问题内容。" });
      return;
    }
    if (selectionText.length > MAX_SELECTION_CHARS) {
      res.status(400).json({ error: "选中的文字太长了，请缩短后再试。" });
      return;
    }
    // Keep only the most recent turns — a runaway card history would
    // otherwise inflate every follow-up request without improving answers.
    const history = Array.isArray(body?.history) ? body.history.slice(-40) : [];
    await streamSse(
      res,
      options.getProvider().streamAnswer({
        selectionText,
        pageNumber: body?.pageNumber ?? null,
        question,
        history,
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
    questionActionLabel: "Ask ZhiJiao",
    maxSelectionChars: MAX_SELECTION_CHARS,
    setupRequired: options.getSetupRequired(),
    connectionLabel: options.getConnectionLabel(),
    notesReady: options.getNotesReady ? options.getNotesReady() : false,
    translationTrigger: options.getTranslationTrigger ? options.getTranslationTrigger() : "selection",
    annotationAuthor: options.getAnnotationAuthor ? options.getAnnotationAuthor() : "",
  };
}

function getProviderErrorMessage(providerName: ProviderName) {
  if (providerName === "cloud") {
    return "还没有填写知交订阅订阅码，请在设置中填写。";
  }
  if (providerName === "openai") {
    return "还没有配置 OpenAI API key，请在设置中填写。";
  }
  if (providerName === "deepseek") {
    return "还没有配置 DeepSeek API key，请在设置中填写。";
  }
  if (providerName === "sjtu") {
    return "SJTU API 连接信息不完整，请在设置中填写。";
  }
  if (providerName === "custom") {
    return "自定义 API 连接信息不完整，请在设置中填写。";
  }
  return "当前服务提供方尚未就绪，请检查设置。";
}

// Exported for tests — routes use it via the router handlers above.
export async function streamSse(res: Response, iterablePromise: Promise<AsyncIterable<string>>) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  writeSseEvent(res, "status", { message: "Request accepted." });

  const heartbeatId = setInterval(() => {
    writeSseEvent(res, "status", { message: "The model is still working." });
  }, 10000);

  // When the client goes away (45s frontend timeout, closed card, closed
  // window), stop consuming the provider stream instead of paying for the
  // rest of the completion. Breaking out of the for-await calls the
  // iterator's return(), which aborts the underlying HTTP stream.
  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
  });

  try {
    const iterable = await iterablePromise;
    for await (const chunk of iterable) {
      if (clientGone) {
        break;
      }
      writeSseEvent(res, "delta", { text: chunk });
    }
    if (!clientGone) {
      writeSseEvent(res, "done", { ok: true });
      res.end();
    }
  } catch (error) {
    if (!clientGone) {
      const message = error instanceof Error ? error.message : "未知的 AI 错误";
      writeSseEvent(res, "error", { error: message });
      res.end();
    }
  } finally {
    clearInterval(heartbeatId);
  }
}

function writeSseEvent(res: Response, event: string, payload: Record<string, unknown>) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}
