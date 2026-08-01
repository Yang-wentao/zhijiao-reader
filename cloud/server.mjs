// 知交云 API 网关：激活码鉴权 → 额度检查 → DeepSeek 转发（SSE）→ 用量入账。
// The SSE event protocol (status / delta / done / error) matches the desktop
// app's existing /api/*/stream contract so the client-side parser is reused.
import express from "express";
import { loadEnv, CLOUD_DIR } from "./env.mjs";
import { CloudDb } from "./db.mjs";
import { buildAskMessages, buildTranslationMessages } from "./prompts.mjs";
import { streamChat, estimateTokens, DeepSeekError } from "./deepseek.mjs";
import { join } from "node:path";

const MAX_SELECTION_CHARS = 8000;
const MAX_HISTORY_TURNS = 40;
const HEARTBEAT_MS = 10_000;

export function createApp({ db, config }) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/v1/health", (_req, res) => {
    res.json({ ok: true, service: "zhijiao-cloud" });
  });

  // Activation-code auth for everything below.
  app.use("/v1", (req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    const header = req.headers.authorization ?? "";
    const code = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!code) {
      res.status(401).json({ error: "缺少激活码。请在设置中填写知交云激活码。" });
      return;
    }
    const row = db.authenticate(code);
    if (!row) {
      res.status(401).json({ error: "激活码无效或已停用。" });
      return;
    }
    req.codeRow = row;
    next();
  });

  app.get("/v1/me", (req, res) => {
    const row = req.codeRow;
    res.json({
      label: row.label,
      quotaTokens: row.quota_tokens,
      usedTokens: row.used_tokens,
      remainingTokens: Math.max(0, row.quota_tokens - row.used_tokens),
      period: row.period,
    });
  });

  app.post("/v1/translate/stream", async (req, res) => {
    const selectionText = typeof req.body?.selectionText === "string" ? req.body.selectionText.trim() : "";
    if (!selectionText) {
      res.status(400).json({ error: "没有收到选中的文字。" });
      return;
    }
    if (selectionText.length > MAX_SELECTION_CHARS) {
      res.status(400).json({ error: "选中的文字太长了，请缩短后再试。" });
      return;
    }
    const pageNumber = typeof req.body?.pageNumber === "number" ? req.body.pageNumber : null;
    await streamToClient(req, res, {
      db,
      config,
      kind: "translate",
      temperature: 0.3,
      messages: buildTranslationMessages(selectionText, pageNumber),
    });
  });

  app.post("/v1/ask/stream", async (req, res) => {
    const selectionText = typeof req.body?.selectionText === "string" ? req.body.selectionText.trim() : "";
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!selectionText || !question) {
      res.status(400).json({ error: "缺少选中的文字或问题内容。" });
      return;
    }
    if (selectionText.length > MAX_SELECTION_CHARS) {
      res.status(400).json({ error: "选中的文字太长了，请缩短后再试。" });
      return;
    }
    const pageNumber = typeof req.body?.pageNumber === "number" ? req.body.pageNumber : null;
    const history = Array.isArray(req.body?.history)
      ? req.body.history
          .filter(
            (entry) =>
              entry &&
              (entry.role === "user" || entry.role === "assistant") &&
              typeof entry.content === "string",
          )
          .slice(-MAX_HISTORY_TURNS)
      : [];
    await streamToClient(req, res, {
      db,
      config,
      kind: "ask",
      temperature: 0.5,
      messages: buildAskMessages(selectionText, pageNumber, question, history),
    });
  });

  return app;
}

async function streamToClient(req, res, { db, config, kind, temperature, messages }) {
  const row = req.codeRow;
  if (!db.hasQuotaRemaining(row)) {
    res.status(402).json({
      error: `本月额度已用完（${row.used_tokens}/${row.quota_tokens} tokens）。请联系开发者充值。`,
    });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  writeSse(res, "status", { message: "Request accepted." });

  const heartbeatId = setInterval(() => {
    writeSse(res, "status", { message: "The model is still working." });
  }, HEARTBEAT_MS);

  // Client gone → abort the upstream request so we stop paying for tokens
  // nobody will see (same policy as the desktop app's local server).
  const upstreamAbort = new AbortController();
  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
    upstreamAbort.abort();
  });

  let outputText = "";
  let usage = null;
  try {
    const stream = streamChat(messages, {
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      temperature,
      thinkingMode: config.thinkingMode,
      signal: upstreamAbort.signal,
    });
    for await (const event of stream) {
      if (event.type === "delta") {
        outputText += event.text;
        if (!clientGone) {
          writeSse(res, "delta", { text: event.text });
        }
      } else if (event.type === "usage") {
        usage = event;
      }
    }
    if (!clientGone) {
      writeSse(res, "done", { ok: true });
      res.end();
    }
  } catch (error) {
    if (!clientGone && !upstreamAbort.signal.aborted) {
      const message =
        error instanceof DeepSeekError ? error.message : "上游模型暂时不可用，请稍后重试。";
      console.error(`[zhijiao-cloud] upstream error (${kind}):`, error);
      writeSse(res, "error", { error: message });
      res.end();
    }
  } finally {
    clearInterval(heartbeatId);
    // Bill actual usage when the upstream reported it; otherwise (aborted
    // mid-stream) fall back to a conservative estimate of what we consumed.
    const inputTokens =
      usage?.inputTokens ?? estimateTokens(messages.map((m) => m.content).join("\n"));
    const outputTokens = usage?.outputTokens ?? (outputText ? estimateTokens(outputText) : 0);
    if (inputTokens > 0 || outputTokens > 0) {
      try {
        db.recordUsage(row.code, { kind, inputTokens, outputTokens, model: config.model });
      } catch (error) {
        console.error("[zhijiao-cloud] failed to record usage:", error);
      }
    }
  }
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function loadConfigFromEnv(env = process.env) {
  return {
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    model: env.DEEPSEEK_MODEL || "deepseek-v4-flash",
    baseUrl: env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    thinkingMode: env.DEEPSEEK_THINKING_MODE === "enabled" ? "enabled" : "disabled",
    port: Number(env.PORT || 8787),
    dbPath: env.CLOUD_DB_PATH || join(CLOUD_DIR, "data", "zhijiao-cloud.db"),
  };
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isDirectRun) {
  loadEnv();
  const config = loadConfigFromEnv();
  if (!config.apiKey) {
    console.error("缺少 DEEPSEEK_API_KEY（在 cloud/.env 或环境变量中设置）。");
    process.exit(1);
  }
  const db = new CloudDb(config.dbPath);
  const app = createApp({ db, config });
  app.listen(config.port, "127.0.0.1", () => {
    console.log(`[zhijiao-cloud] listening on http://127.0.0.1:${config.port}`);
  });
}
