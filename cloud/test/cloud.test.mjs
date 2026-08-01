import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { CloudDb } from "../db.mjs";
import { createApp } from "../server.mjs";

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

function startApp(db, upstreamPort, adminToken = "") {
  const app = createApp({
    db,
    config: {
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      thinkingMode: "disabled",
      adminToken,
    },
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
