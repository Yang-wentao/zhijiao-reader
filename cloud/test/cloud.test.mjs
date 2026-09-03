import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { CloudDb, normalizeCode } from "../db.mjs";
import { createApp, clientIp } from "../server.mjs";
import { AuthThrottle, RateLimiter } from "../ratelimit.mjs";

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

// ── custom (memorable) codes ──────────────────────────────────────────────

test("createCode accepts a chosen code and normalizes it", () => {
  const db = new CloudDb(":memory:");
  const row = db.createCode({ label: "小红书", quotaTokens: 100, code: " zj-math-2026 " });
  assert.equal(row.code, "ZJ-MATH-2026");
  assert.ok(db.authenticate("ZJ-MATH-2026"));
  // Codes are matched exactly — the client is expected to send it as issued.
  assert.equal(db.authenticate("zj-math-2026"), null);
  db.close();
});

test("createCode rejects bad shapes and duplicates", () => {
  const db = new CloudDb(":memory:");
  assert.throws(() => db.createCode({ quotaTokens: 100, code: "AB" }), /格式不对/);
  assert.throws(() => db.createCode({ quotaTokens: 100, code: "-LEAD" }), /格式不对/);
  assert.throws(() => db.createCode({ quotaTokens: 100, code: "TRAIL-" }), /格式不对/);
  assert.throws(() => db.createCode({ quotaTokens: 100, code: "A--B" }), /格式不对/);
  assert.throws(() => db.createCode({ quotaTokens: 100, code: "ZJ_UNDERSCORE" }), /格式不对/);

  db.createCode({ quotaTokens: 100, code: "ZJ-TAKEN-01" });
  assert.throws(() => db.createCode({ quotaTokens: 100, code: "zj-taken-01" }), /已存在/);
  db.close();
});

test("normalizeCode is exposed for reuse", () => {
  assert.equal(normalizeCode("  zj-1111-2222  "), "ZJ-1111-2222");
});

test("admin api mints a custom code and reports bad ones", async () => {
  const db = new CloudDb(":memory:");
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port, "secret-token");
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { Authorization: "Bearer secret-token", "Content-Type": "application/json" };

  const created = await (
    await fetch(`${base}/admin/api/codes`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ label: "小红书", quotaTokens: 500, code: "zj-xhs-2026" }),
    })
  ).json();
  assert.equal(created.code, "ZJ-XHS-2026");

  const bad = await fetch(`${base}/admin/api/codes`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ label: "", quotaTokens: 500, code: "??" }),
  });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /格式不对/);

  server.close();
  upstream.close();
  db.close();
});

// ── wrong-code guessing defence ───────────────────────────────────────────

test("auth throttle blocks an IP after repeated wrong codes", () => {
  const throttle = new AuthThrottle({ windowMs: 1000, maxFailures: 3 });
  const ip = "203.0.113.7";
  assert.equal(throttle.isBlocked(ip, 1000), false);
  throttle.recordFailure(ip, 1000);
  throttle.recordFailure(ip, 1100);
  assert.equal(throttle.isBlocked(ip, 1200), false);
  throttle.recordFailure(ip, 1200);
  assert.equal(throttle.isBlocked(ip, 1300), true);

  // Another address is unaffected, and the window eventually slides past.
  assert.equal(throttle.isBlocked("198.51.100.4", 1300), false);
  assert.equal(throttle.isBlocked(ip, 2500), false);

  // A correct code clears the record so a fumbling user isn't stuck.
  throttle.recordFailure(ip, 3000);
  throttle.recordFailure(ip, 3000);
  throttle.recordFailure(ip, 3000);
  assert.equal(throttle.isBlocked(ip, 3000), true);
  throttle.recordSuccess(ip);
  assert.equal(throttle.isBlocked(ip, 3000), false);
});

test("repeated wrong codes over HTTP get 429, valid code still works", async () => {
  const db = new CloudDb(":memory:");
  const good = db.createCode({ label: "真用户", quotaTokens: 1000 }).code;
  const upstream = await startMockUpstream();
  const throttle = new AuthThrottle({ windowMs: 60_000, maxFailures: 3 });
  const app = createApp({
    db,
    config: {
      apiKey: "k",
      model: "m",
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
      thinkingMode: "disabled",
      adminToken: "",
    },
    authThrottle: throttle,
  });
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const attacker = { "CF-Connecting-IP": "203.0.113.9" };

  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${base}/v1/me`, {
      headers: { Authorization: "Bearer ZJ-GUESS-GUESS", ...attacker },
    });
    assert.equal(res.status, 401);
  }
  const blocked = await fetch(`${base}/v1/me`, {
    headers: { Authorization: `Bearer ${good}`, ...attacker },
  });
  assert.equal(blocked.status, 429, "blocked IP is refused even with a valid code");

  // A different address is untouched.
  const other = await fetch(`${base}/v1/me`, {
    headers: { Authorization: `Bearer ${good}`, "CF-Connecting-IP": "198.51.100.5" },
  });
  assert.equal(other.status, 200);

  server.close();
  upstream.close();
  db.close();
});

// ── time-limited trial codes ──────────────────────────────────────────────

test("expiring code stops authenticating after its deadline", () => {
  const db = new CloudDb(":memory:");
  const start = new Date("2026-08-04T00:00:00.000Z");
  const row = db.createCode({ label: "试用", quotaTokens: 1000, code: "ZJ-TRY-7", expiresInDays: 7, now: start });
  assert.equal(row.expires_at, "2026-08-11T00:00:00.000Z");

  assert.ok(db.authenticate("ZJ-TRY-7", new Date("2026-08-10T23:59:00.000Z")));
  assert.equal(db.authenticate("ZJ-TRY-7", new Date("2026-08-11T00:00:01.000Z")), null);

  // Extending it brings the code back.
  db.setExpiry("ZJ-TRY-7", 30, new Date("2026-08-12T00:00:00.000Z"));
  assert.ok(db.authenticate("ZJ-TRY-7", new Date("2026-08-20T00:00:00.000Z")));

  // 0 days = no expiry at all.
  db.setExpiry("ZJ-TRY-7", 0);
  assert.equal(db.getCode("ZJ-TRY-7").expires_at, "");
  db.close();
});

test("codes without an expiry are unaffected", () => {
  const db = new CloudDb(":memory:");
  const row = db.createCode({ label: "长期", quotaTokens: 1000 });
  assert.equal(row.expires_at, "");
  assert.ok(db.authenticate(row.code, new Date("2099-01-01T00:00:00.000Z")));
  db.close();
});

test("expired code gets a message that says what to do", async () => {
  const db = new CloudDb(":memory:");
  // Expired an hour ago.
  const code = db.createCode({
    label: "试用",
    quotaTokens: 1000,
    code: "ZJ-GONE",
    expiresInDays: 1,
    now: new Date(Date.now() - 25 * 3600_000),
  }).code;
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port);
  const base = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${base}/v1/me`, { headers: { Authorization: `Bearer ${code}` } });
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /已过期/);

  server.close();
  upstream.close();
  db.close();
});

// ── admin key: guessing defence ───────────────────────────────────────────

test("admin key survives brute force: throttled per IP after 5 misses", async () => {
  const db = new CloudDb(":memory:");
  const upstream = await startMockUpstream();
  const throttle = new AuthThrottle({ windowMs: 60_000, maxFailures: 5 });
  const app = createApp({
    db,
    config: {
      apiKey: "k",
      model: "m",
      baseUrl: `http://127.0.0.1:${upstream.address().port}`,
      thinkingMode: "disabled",
      adminToken: "the-real-admin-token",
    },
    adminThrottle: throttle,
  });
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const attacker = { "CF-Connecting-IP": "203.0.113.66" };

  for (let i = 0; i < 5; i += 1) {
    const res = await fetch(`${base}/admin/api/overview`, {
      headers: { Authorization: `Bearer guess-${i}`, ...attacker },
    });
    assert.equal(res.status, 401);
  }
  // Sixth attempt is refused outright — and so is the correct key from that
  // address, which is the point: the attacker gets no oracle.
  const blocked = await fetch(`${base}/admin/api/overview`, {
    headers: { Authorization: "Bearer the-real-admin-token", ...attacker },
  });
  assert.equal(blocked.status, 429);

  // The owner, on a different address, is unaffected.
  const owner = await fetch(`${base}/admin/api/overview`, {
    headers: { Authorization: "Bearer the-real-admin-token", "CF-Connecting-IP": "198.51.100.8" },
  });
  assert.equal(owner.status, 200);

  server.close();
  upstream.close();
  db.close();
});

test("admin key comparison is length-agnostic and exact", async () => {
  const db = new CloudDb(":memory:");
  const upstream = await startMockUpstream();
  const server = await startApp(db, upstream.address().port, "correct-horse-battery");
  const base = `http://127.0.0.1:${server.address().port}`;

  // A prefix of the real token must not pass (hashing both sides means the
  // compare never short-circuits on length).
  for (const bad of ["correct", "correct-horse-batteryX", "", "CORRECT-HORSE-BATTERY"]) {
    const res = await fetch(`${base}/admin/api/overview`, {
      headers: { Authorization: `Bearer ${bad}`, "CF-Connecting-IP": `198.51.100.${bad.length + 20}` },
    });
    assert.equal(res.status, 401, `token "${bad}" must be rejected`);
  }
  const ok = await fetch(`${base}/admin/api/overview`, {
    headers: { Authorization: "Bearer correct-horse-battery", "CF-Connecting-IP": "198.51.100.99" },
  });
  assert.equal(ok.status, 200);

  server.close();
  upstream.close();
  db.close();
});
