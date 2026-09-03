// 知交订阅 API 网关：订阅码鉴权 → 限流 → 额度检查 → DeepSeek 转发（SSE）→ 用量入账。
// The SSE event protocol (status / delta / done / error) matches the desktop
// app's existing /api/*/stream contract so the client-side parser is reused.
import express from "express";
import { loadEnv, CLOUD_DIR } from "./env.mjs";
import { CloudDb } from "./db.mjs";
import { buildAskMessages, buildTranslationMessages } from "./prompts.mjs";
import { streamChat, estimateTokens, DeepSeekError } from "./deepseek.mjs";
import { AuthThrottle, RateLimiter } from "./ratelimit.mjs";
import { join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_SELECTION_CHARS = 8000;
const MAX_HISTORY_TURNS = 40;
const HEARTBEAT_MS = 10_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;

// Desktop installer downloads. `/latest/download/` always resolves to the
// newest published release, but the file names carry the version — so bump
// RELEASE_VERSION together with package.json when cutting a release.
const RELEASE_VERSION = "1.1.2";
const RELEASE_BASE = "https://github.com/Yang-wentao/zhijiao-reader/releases/latest/download";
export const DOWNLOADS = {
  "mac-arm64": `ZhijiaoReader-${RELEASE_VERSION}-arm64.dmg`,
  "mac-x64": `ZhijiaoReader-${RELEASE_VERSION}-x64.dmg`,
  "win-x64": `ZhijiaoReader-Setup-${RELEASE_VERSION}-x64.exe`,
};

// The caller's real address. Requests arrive through the Cloudflare tunnel,
// so the socket address is always the loopback — CF-Connecting-IP carries the
// browser's address. Trusted because nothing but the tunnel can reach this
// process (the gateway binds 127.0.0.1 only).
export function clientIp(req) {
  const header = req.headers["cf-connecting-ip"];
  if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return req.ip ?? "";
}

// Constant-time token comparison. Hashing first gives both sides a fixed
// length, so timingSafeEqual can never throw on a length mismatch — and the
// length of the real token isn't leaked by how fast the compare returns.
function tokenMatches(given, expected) {
  if (!expected) {
    return false;
  }
  const a = createHash("sha256").update(String(given)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

export function createApp({
  db,
  config,
  rateLimiter = new RateLimiter(),
  authThrottle = new AuthThrottle(),
  // The admin key guards every code and the whole usage log, so it gets a
  // tighter budget than a subscriber fumbling their own code.
  adminThrottle = new AuthThrottle({ maxFailures: 5 }),
}) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Keep the limiters' per-key maps from accumulating every code / IP ever
  // seen. unref() so this timer never holds the process (or a test run) open.
  setInterval(() => {
    rateLimiter.sweep();
    authThrottle.sweep();
    adminThrottle.sweep();
  }, SWEEP_INTERVAL_MS).unref?.();

  app.get("/v1/health", (_req, res) => {
    res.json({ ok: true, service: "zhijiao-cloud" });
  });

  // Stable download URLs on our own domain. The landing page links to
  // /download/<target>; only this map knows where the installers actually
  // live, so a new release is a one-line change here instead of an edit in
  // every button on the page.
  app.get("/download/:target", (req, res) => {
    const file = DOWNLOADS[req.params.target];
    if (!file) {
      res.status(404).json({ error: "没有这个下载项。" });
      return;
    }
    res.redirect(302, `${RELEASE_BASE}/${file}`);
  });

  // Landing page (repo's site/ directory) served from the same process, so the
  // root domain and the API share one tunnel and one deploy. Static files only
  // — /v1 and /admin are matched before this ever runs.
  app.use(express.static(join(CLOUD_DIR, "..", "site"), { extensions: ["html"] }));

  attachAdminRoutes(app, { db, adminToken: config.adminToken, adminThrottle });

  // Activation-code auth for everything below.
  app.use("/v1", (req, res, next) => {
    if (req.path === "/health") {
      next();
      return;
    }
    const ip = clientIp(req);
    // Guessing defence: too many wrong codes from one address and that
    // address is paused. Wrong codes never reach the per-code limiter, so
    // without this a hand-picked (low-entropy) code could be brute-forced.
    if (authThrottle.isBlocked(ip)) {
      console.log(`[zhijiao-cloud] 订阅码尝试过多，暂时拒绝 来源=${ip}`);
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "订阅码错误次数过多，请 1 分钟后再试。" });
      return;
    }
    const header = req.headers.authorization ?? "";
    const code = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!code) {
      res.status(401).json({ error: "缺少订阅码。请在设置中填写知交订阅的订阅码。" });
      return;
    }
    const row = db.authenticate(code);
    if (!row) {
      authThrottle.recordFailure(ip);
      // Distinguish "your trial ran out" from "that code is wrong" — the
      // first has an obvious next step, the second doesn't.
      const known = db.getCode(code);
      const expired = known?.expires_at && new Date(known.expires_at) <= new Date();
      res.status(401).json({
        error: expired
          ? "这个试用码已过期。可以联系作者领取长期订阅码。"
          : "订阅码无效或已停用。",
      });
      return;
    }
    authThrottle.recordSuccess(ip);
    req.codeRow = row;
    next();
  });

  // Rate limiting guards the streaming endpoints only — /me is cheap and gets
  // polled by the settings screen.
  app.use(["/v1/translate", "/v1/ask"], (req, res, next) => {
    const verdict = rateLimiter.check(req.codeRow.code);
    if (!verdict.ok) {
      console.log(
        `[zhijiao-cloud] 限流 用户=${req.codeRow.label || req.codeRow.code} ` +
          `原因=${verdict.reason} 来源=${clientIp(req)}`,
      );
      res.setHeader("Retry-After", String(verdict.retryAfterSeconds));
      res.status(429).json({ error: verdict.message });
      return;
    }
    next();
  });

  app.get("/v1/me", (req, res) => {
    const row = req.codeRow;
    res.json({
      // The model the gateway actually calls — the client shows this in its
      // header chip, so it stays truthful if this deployment switches models.
      model: config.model,
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
      rateLimiter,
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
      rateLimiter,
      kind: "ask",
      temperature: 0.5,
      messages: buildAskMessages(selectionText, pageNumber, question, history),
    });
  });

  return app;
}

// Admin dashboard: /admin serves a single-page console; /admin/api/* requires
// the ADMIN_TOKEN from cloud/.env. With no token configured the whole area is
// disabled (403) so a fresh deploy can never be managed anonymously.
function attachAdminRoutes(app, { db, adminToken, adminThrottle }) {
  app.get("/admin", (_req, res) => {
    res.sendFile(join(CLOUD_DIR, "public", "admin.html"));
  });

  app.use("/admin/api", (req, res, next) => {
    if (!adminToken) {
      res.status(403).json({ error: "管理台未启用：请在 cloud/.env 中设置 ADMIN_TOKEN 后重启。" });
      return;
    }
    const ip = clientIp(req);
    // Without this the admin key could be guessed at unlimited speed — it is
    // the one secret that unlocks every code and the entire usage log.
    if (adminThrottle.isBlocked(ip)) {
      console.log(`[zhijiao-cloud] 管理台尝试过多，暂时拒绝 来源=${ip}`);
      res.setHeader("Retry-After", "60");
      res.status(429).json({ error: "尝试次数过多，请 1 分钟后再试。" });
      return;
    }
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!tokenMatches(token, adminToken)) {
      adminThrottle.recordFailure(ip);
      console.log(`[zhijiao-cloud] ⚠️ 管理台密钥错误 来源=${ip}`);
      res.status(401).json({ error: "管理密钥不正确。" });
      return;
    }
    adminThrottle.recordSuccess(ip);
    next();
  });

  app.get("/admin/api/overview", (_req, res) => {
    res.json(db.overviewStats());
  });

  app.get("/admin/api/codes", (_req, res) => {
    res.json(db.listCodes());
  });

  app.post("/admin/api/codes", (req, res) => {
    const label = typeof req.body?.label === "string" ? req.body.label.trim() : "";
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const expiresInDays = Number(req.body?.expiresInDays) || 0;
    const quotaTokens = Number(req.body?.quotaTokens);
    if (!Number.isFinite(quotaTokens) || quotaTokens <= 0) {
      res.status(400).json({ error: "额度必须是正数。" });
      return;
    }
    try {
      res.json(db.createCode({ label, quotaTokens, code, expiresInDays }));
    } catch (error) {
      // Bad shape or duplicate — both are the caller's problem, not a fault.
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/admin/api/codes/:code/active", (req, res) => {
    const ok = db.setActive(req.params.code, Boolean(req.body?.active));
    if (!ok) {
      res.status(404).json({ error: "找不到这个订阅码。" });
      return;
    }
    res.json(db.getCode(req.params.code));
  });

  app.post("/admin/api/codes/:code/quota", (req, res) => {
    const quotaTokens = Number(req.body?.quotaTokens);
    if (!Number.isFinite(quotaTokens) || quotaTokens <= 0) {
      res.status(400).json({ error: "额度必须是正数。" });
      return;
    }
    const ok = db.setQuota(req.params.code, quotaTokens);
    if (!ok) {
      res.status(404).json({ error: "找不到这个订阅码。" });
      return;
    }
    res.json(db.getCode(req.params.code));
  });

  app.post("/admin/api/codes/:code/expiry", (req, res) => {
    const ok = db.setExpiry(req.params.code, Number(req.body?.expiresInDays) || 0);
    if (!ok) {
      res.status(404).json({ error: "找不到这个订阅码。" });
      return;
    }
    res.json(db.getCode(req.params.code));
  });

  app.get("/admin/api/usage", (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    res.json(db.recentUsage(limit));
  });

  // Which addresses have used one 订阅码 — the "is this code being shared?"
  // view. Many distinct IPs on one code is the signal to disable it.
  app.get("/admin/api/codes/:code/sources", (req, res) => {
    res.json(db.codeSources(req.params.code));
  });
}

async function streamToClient(req, res, { db, config, rateLimiter, kind, temperature, messages }) {
  const row = req.codeRow;
  const ip = clientIp(req);
  if (!db.hasQuotaRemaining(row)) {
    res.status(402).json({
      error: `本月额度已用完（${row.used_tokens}/${row.quota_tokens} tokens）。请联系开发者充值。`,
    });
    return;
  }

  // Hold a concurrency slot for as long as this stream is open. Released in
  // the finally below, so aborts and upstream crashes can't leak it.
  const releaseSlot = rateLimiter ? rateLimiter.acquire(row.code) : () => {};

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
    releaseSlot();
    // Bill actual usage when the upstream reported it; otherwise (aborted
    // mid-stream) fall back to a conservative estimate of what we consumed.
    const inputTokens =
      usage?.inputTokens ?? estimateTokens(messages.map((m) => m.content).join("\n"));
    const outputTokens = usage?.outputTokens ?? (outputText ? estimateTokens(outputText) : 0);
    if (inputTokens > 0 || outputTokens > 0) {
      try {
        db.recordUsage(row.code, { kind, inputTokens, outputTokens, model: config.model, ip });
      } catch (error) {
        console.error("[zhijiao-cloud] failed to record usage:", error);
      }
    }
    // One access-log line per request so `tail -f cloud.log` shows traffic live.
    console.log(
      `[zhijiao-cloud] ${new Date().toISOString()} ${kind} 用户=${row.label || row.code} ` +
        `来源=${ip || "未知"} 输入=${inputTokens} 输出=${outputTokens} tokens` +
        `${clientGone ? "（客户端中途断开）" : ""}`,
    );
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
    adminToken: env.ADMIN_TOKEN?.trim() || "",
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
