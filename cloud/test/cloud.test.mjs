import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { CloudDb } from "../db.mjs";
import { createApp, clientIp } from "../server.mjs";
import { RateLimiter } from "../ratelimit.mjs";

// ── db logic ──────────────────────────────────────────────────────────────

test("createCode / authenticate / quota lifecycle", () => {
  const db = new CloudDb(":memory:");
  const row = db.createCode({ label: "测试", quotaTokens: 100 });
  assert.match(row.code, /^ZJ-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);

  const authed = db.authenticate(row.code);
  assert.equal(authed.label, "测试");
  assert.ok(db.hasQuotaRemaining(authed));

  db.recordUsage(row.code, { kind: "translate", inputTokens: 60, outputTokens: 50, model: "m" });
  const spent = db.getCode(row.code);
  assert.equal(spent.used_tokens, 110);
  assert.ok(!db.hasQuotaRemaining(spent));

  assert.equal(db.authenticate("ZJ-NOPE-NOPE-NOPE"), null);
  db.setActive(row.code, false);
  assert.equal(db.authenticate(row.code), null);
  db.close();
});

test("monthly window resets used_tokens", () => {
  const db = new CloudDb(":memory:");
  const row = db.createCode({ label: "", quotaTokens: 100 });
  db.recordUsage(row.code, { kind: "ask", inputTokens: 40, outputTokens: 60, model: "m" });
  assert.ok(!db.hasQuotaRemaining(db.getCode(row.code)));

  // Next calendar month → usage window rolls over, quota is fresh again.
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const rolled = db.authenticate(row.code, nextMonth);
  assert.equal(rolled.used_tokens, 0);
  assert.ok(db.hasQuotaRemaining(rolled));
  db.close();
});

// ── HTTP layer against a mock upstream ────────────────────────────────────

function startMockUpstream() {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const frames = [
      { choices: [{ delta: { content: "你好" } }] },
      { choices: [{ delta: { content: "，世界" } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 12, completion_tokens: 7 } },
    ];
    for (const frame of frames) {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function startApp(db, upstreamPort, adminToken = "", rateLimiter = undefined) {
  const app = createApp({
    db,
    config: {
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      thinkingMode: "disabled",
      adminToken,
    },
    ...(rateLimiter ? { rateLimiter } : {}),
  });
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("translate stream: auth, forwarding, metering", async () => {
  const db = new CloudDb(":memory:");
  const code = db.createCode({ label: "e2e", quotaTokens: 1000 }).code;
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port);
  const base = `http://127.0.0.1:${server.address().port}`;

  // No code → 401.
  const anon = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectionText: "hello" }),
  });
  assert.equal(anon.status, 401);

  // Valid code → SSE stream with deltas and done.
  const ok = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${code}` },
    body: JSON.stringify({ selectionText: "hello world", pageNumber: 3 }),
  });
  assert.equal(ok.status, 200);
  const body = await ok.text();
  assert.ok(body.includes("event: delta"));
  assert.ok(body.includes("你好"));
  assert.ok(body.includes("event: done"));

  // Usage from the mock (12 + 7) was billed to the code.
  const row = db.getCode(code);
  assert.equal(row.used_tokens, 19);

  // /v1/me reflects the same numbers.
  const me = await fetch(`${base}/v1/me`, { headers: { Authorization: `Bearer ${code}` } });
  const meBody = await me.json();
  assert.equal(meBody.usedTokens, 19);
  assert.equal(meBody.remainingTokens, 981);

  server.close();
  upstream.close();
  db.close();
});

test("exhausted quota → 402 and no upstream call", async () => {
  const db = new CloudDb(":memory:");
  const code = db.createCode({ label: "", quotaTokens: 10 }).code;
  db.recordUsage(code, { kind: "translate", inputTokens: 5, outputTokens: 6, model: "m" });

  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port);
  const base = `http://127.0.0.1:${server.address().port}`;

  const blocked = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${code}` },
    body: JSON.stringify({ selectionText: "hello" }),
  });
  assert.equal(blocked.status, 402);
  const body = await blocked.json();
  assert.ok(body.error.includes("额度"));

  server.close();
  upstream.close();
  db.close();
});

test("admin api: token gate + code management", async () => {
  const db = new CloudDb(":memory:");
  db.recordUsage(db.createCode({ label: "a", quotaTokens: 100 }).code, {
    kind: "translate",
    inputTokens: 10,
    outputTokens: 5,
    model: "m",
  });
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port, "secret-token");
  const base = `http://127.0.0.1:${server.address().port}`;

  // Wrong / missing token → 401.
  const anon = await fetch(`${base}/admin/api/overview`);
  assert.equal(anon.status, 401);

  const auth = { Authorization: "Bearer secret-token", "Content-Type": "application/json" };
  const overview = await (await fetch(`${base}/admin/api/overview`, { headers: auth })).json();
  assert.equal(overview.codesTotal, 1);
  assert.equal(overview.allTime.requests, 1);
  assert.equal(overview.allTime.tokens, 15);

  // Create + disable a code through the HTTP API.
  const created = await (
    await fetch(`${base}/admin/api/codes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ label: "网页发码", quotaTokens: 500 }),
    })
  ).json();
  assert.match(created.code, /^ZJ-/);
  const disabled = await (
    await fetch(`${base}/admin/api/codes/${created.code}/active`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ active: false }),
    })
  ).json();
  assert.equal(disabled.active, 0);

  const usage = await (await fetch(`${base}/admin/api/usage?limit=10`, { headers: auth })).json();
  assert.equal(usage.length, 1);
  assert.equal(usage[0].label, "a");

  server.close();
  upstream.close();
  db.close();
});

test("admin api disabled without ADMIN_TOKEN", async () => {
  const db = new CloudDb(":memory:");
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port, "");
  const base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(`${base}/admin/api/overview`, {
    headers: { Authorization: "Bearer anything" },
  });
  assert.equal(res.status, 403);
  server.close();
  upstream.close();
  db.close();
});

test("input validation", async () => {
  const db = new CloudDb(":memory:");
  const code = db.createCode({ label: "", quotaTokens: 1000 }).code;
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port);
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${code}` };

  const empty = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selectionText: "" }),
  });
  assert.equal(empty.status, 400);

  const tooLong = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selectionText: "x".repeat(8001) }),
  });
  assert.equal(tooLong.status, 400);

  const askMissing = await fetch(`${base}/v1/ask/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selectionText: "text", question: "" }),
  });
  assert.equal(askMissing.status, 400);

  server.close();
  upstream.close();
  db.close();
});

// ── rate limiting ─────────────────────────────────────────────────────────

test("rate limiter: sliding window", () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 3, maxConcurrent: 99 });
  const t0 = 10_000;
  assert.ok(limiter.check("A", t0).ok);
  assert.ok(limiter.check("A", t0 + 100).ok);
  assert.ok(limiter.check("A", t0 + 200).ok);

  const blocked = limiter.check("A", t0 + 300);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "rate");
  assert.ok(blocked.retryAfterSeconds >= 1);
  assert.match(blocked.message, /请求过于频繁/);

  // A different code has its own budget.
  assert.ok(limiter.check("B", t0 + 300).ok);

  // Once the window has slid past the old hits, the code is allowed again.
  assert.ok(limiter.check("A", t0 + 1500).ok);
});

test("rate limiter: concurrency cap and slot release", () => {
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 99, maxConcurrent: 2 });
  assert.ok(limiter.check("A").ok);
  const release1 = limiter.acquire("A");
  assert.ok(limiter.check("A").ok);
  const release2 = limiter.acquire("A");

  const blocked = limiter.check("A");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "concurrency");
  assert.match(blocked.message, /同时进行的请求太多/);

  release1();
  release1(); // double release must not free an extra slot
  assert.ok(limiter.check("A").ok);
  const release3 = limiter.acquire("A");
  assert.equal(limiter.check("A").ok, false);

  release2();
  release3();
  assert.equal(limiter.active.has("A"), false);
});

test("rate limiter: sweep drops idle codes", () => {
  const limiter = new RateLimiter({ windowMs: 1000, maxRequests: 5, maxConcurrent: 5 });
  limiter.check("A", 1000);
  assert.equal(limiter.hits.has("A"), true);
  limiter.sweep(5000);
  assert.equal(limiter.hits.has("A"), false);
});

test("over the limit → 429 with Retry-After, no upstream call", async () => {
  const db = new CloudDb(":memory:");
  const code = db.createCode({ label: "刷子", quotaTokens: 100000 }).code;
  const upstream = await startMockUpstream();
  // maxRequests: 1 so the second call is refused immediately.
  const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1, maxConcurrent: 5 });
  const server = await startApp(db, upstream.address().port, "", limiter);
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${code}` };

  const first = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selectionText: "hello" }),
  });
  assert.equal(first.status, 200);
  await first.text();
  const billed = db.getCode(code).used_tokens;

  const second = await fetch(`${base}/v1/translate/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ selectionText: "hello again" }),
  });
  assert.equal(second.status, 429);
  assert.equal(second.headers.get("retry-after") !== null, true);
  assert.match((await second.json()).error, /请求过于频繁/);

  // Refused before reaching DeepSeek — nothing extra was billed.
  assert.equal(db.getCode(code).used_tokens, billed);

  // /v1/me is not rate limited: the settings screen must always be able to
  // report quota, even for a code that is being throttled.
  const me = await fetch(`${base}/v1/me`, { headers: { Authorization: `Bearer ${code}` } });
  assert.equal(me.status, 200);

  server.close();
  upstream.close();
  db.close();
});

// ── source IP tracking ────────────────────────────────────────────────────

test("clientIp prefers CF-Connecting-IP over the socket address", () => {
  assert.equal(clientIp({ headers: { "cf-connecting-ip": " 203.0.113.7 " }, ip: "127.0.0.1" }), "203.0.113.7");
  assert.equal(clientIp({ headers: {}, ip: "127.0.0.1" }), "127.0.0.1");
  assert.equal(clientIp({ headers: { "cf-connecting-ip": "  " }, ip: "127.0.0.1" }), "127.0.0.1");
  assert.equal(clientIp({ headers: {} }), "");
});

test("usage rows carry the caller's IP, grouped per code", async () => {
  const db = new CloudDb(":memory:");
  const code = db.createCode({ label: "同学甲", quotaTokens: 100000 }).code;
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port, "admin-secret");
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (ip) => {
    const res = await fetch(`${base}/v1/translate/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${code}`,
        "CF-Connecting-IP": ip,
      },
      body: JSON.stringify({ selectionText: "hello" }),
    });
    await res.text();
  };
  await call("203.0.113.7");
  await call("203.0.113.7");
  await call("198.51.100.4");

  const sources = db.codeSources(code);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].ip, "203.0.113.7");
  assert.equal(sources[0].requests, 2);
  assert.equal(sources[1].ip, "198.51.100.4");

  // Exposed to the admin console too.
  const auth = { Authorization: "Bearer admin-secret" };
  const viaApi = await (await fetch(`${base}/admin/api/codes/${code}/sources`, { headers: auth })).json();
  assert.equal(viaApi[0].ip, "203.0.113.7");

  const feed = await (await fetch(`${base}/admin/api/usage?limit=5`, { headers: auth })).json();
  assert.equal(feed[0].ip, "198.51.100.4");

  server.close();
  upstream.close();
  db.close();
});

test("migration adds the ip column to a pre-existing usage_log", () => {
  // Simulate a v1.1.1 database: usage_log without the ip column.
  const db = new CloudDb(":memory:");
  db.db.exec("DROP TABLE usage_log");
  db.db.exec(`CREATE TABLE usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, ts TEXT NOT NULL,
    kind TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
    model TEXT NOT NULL)`);
  db.migrate();

  const code = db.createCode({ label: "", quotaTokens: 100 }).code;
  db.recordUsage(code, { kind: "translate", inputTokens: 1, outputTokens: 1, model: "m", ip: "203.0.113.7" });
  assert.equal(db.recentUsage(1)[0].ip, "203.0.113.7");
  db.close();
});
