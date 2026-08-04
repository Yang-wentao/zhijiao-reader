// SQLite storage for 订阅码 + usage metering.
// Uses node:sqlite (built into Node 22.5+) — no native compilation on deploy.
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Codes look like ZJ-XXXX-XXXX-XXXX. The alphabet drops easily-confused
// characters (0/O, 1/I/L) so codes survive being read aloud or hand-typed.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomBlock(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export function generateCode() {
  return `ZJ-${randomBlock(4)}-${randomBlock(4)}-${randomBlock(4)}`;
}

// Hand-picked codes (e.g. ZJ-MATH-2026-7K3P) are allowed so a code can be
// short enough to read out or put in a post. Normalized to upper case and
// checked for shape only — deliberately permissive about which characters,
// since the point of a custom code is that a human chose it.
export function normalizeCode(input) {
  const code = String(input ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(code) || code.endsWith("-") || code.includes("--")) {
    throw new Error(
      "订阅码格式不对：4–32 位，只能用字母、数字和连字符，且不能以连字符开头或结尾。",
    );
  }
  return code;
}

function currentPeriod(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export class CloudDb {
  constructor(path) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS codes (
        code TEXT PRIMARY KEY,
        label TEXT NOT NULL DEFAULT '',
        quota_tokens INTEGER NOT NULL,
        used_tokens INTEGER NOT NULL DEFAULT 0,
        period TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        model TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_usage_code_ts ON usage_log(code, ts);
    `);
    this.migrate();
  }

  // Additive migrations for databases created by an earlier version. Each one
  // must be safe to run on every startup.
  migrate() {
    const usageColumns = this.db.prepare("PRAGMA table_info(usage_log)").all();
    if (!usageColumns.some((column) => column.name === "ip")) {
      this.db.exec("ALTER TABLE usage_log ADD COLUMN ip TEXT NOT NULL DEFAULT ''");
    }
    // '' = never expires, which is what every code created before this
    // column existed should keep doing.
    const codeColumns = this.db.prepare("PRAGMA table_info(codes)").all();
    if (!codeColumns.some((column) => column.name === "expires_at")) {
      this.db.exec("ALTER TABLE codes ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
    }
  }

  // `code` is optional: omit it for a random ZJ-XXXX-XXXX-XXXX, or pass one
  // to mint a chosen code. `expiresInDays` makes it a time-limited code —
  // a public trial code should always have one, so the promised end date is
  // enforced by the gateway instead of by remembering to disable it.
  createCode({ label = "", quotaTokens, code = "", expiresInDays = 0, now = new Date() }) {
    const finalCode = code ? normalizeCode(code) : generateCode();
    if (this.getCode(finalCode)) {
      throw new Error(`订阅码 ${finalCode} 已存在。`);
    }
    const days = Number(expiresInDays);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(now.getTime() + days * 86_400_000).toISOString()
        : "";
    this.db
      .prepare(
        "INSERT INTO codes (code, label, quota_tokens, period, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(finalCode, label, quotaTokens, currentPeriod(), now.toISOString(), expiresAt);
    return this.getCode(finalCode);
  }

  setExpiry(code, expiresInDays, now = new Date()) {
    const days = Number(expiresInDays);
    const expiresAt =
      Number.isFinite(days) && days > 0
        ? new Date(now.getTime() + days * 86_400_000).toISOString()
        : "";
    const result = this.db
      .prepare("UPDATE codes SET expires_at = ? WHERE code = ?")
      .run(expiresAt, code);
    return result.changes > 0;
  }

  getCode(code) {
    return this.db.prepare("SELECT * FROM codes WHERE code = ?").get(code) ?? null;
  }

  listCodes() {
    return this.db.prepare("SELECT * FROM codes ORDER BY created_at").all();
  }

  setActive(code, active) {
    const result = this.db
      .prepare("UPDATE codes SET active = ? WHERE code = ?")
      .run(active ? 1 : 0, code);
    return result.changes > 0;
  }

  setQuota(code, quotaTokens) {
    const result = this.db
      .prepare("UPDATE codes SET quota_tokens = ? WHERE code = ?")
      .run(quotaTokens, code);
    return result.changes > 0;
  }

  // Look up a code for a request. Rolls the monthly usage window forward when
  // the calendar month has changed since the last request. Returns the fresh
  // row, or null when the code is unknown / disabled.
  authenticate(code, now = new Date()) {
    const row = this.getCode(code);
    if (!row || !row.active) {
      return null;
    }
    if (row.expires_at && new Date(row.expires_at) <= now) {
      return null;
    }
    const period = currentPeriod(now);
    if (row.period !== period) {
      this.db
        .prepare("UPDATE codes SET period = ?, used_tokens = 0 WHERE code = ?")
        .run(period, code);
      return this.getCode(code);
    }
    return row;
  }

  hasQuotaRemaining(row) {
    return row.used_tokens < row.quota_tokens;
  }

  recordUsage(code, { kind, inputTokens, outputTokens, model, ip = "" }, now = new Date()) {
    const total = inputTokens + outputTokens;
    this.db
      .prepare("UPDATE codes SET used_tokens = used_tokens + ? WHERE code = ?")
      .run(total, code);
    this.db
      .prepare(
        "INSERT INTO usage_log (code, ts, kind, input_tokens, output_tokens, model, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(code, now.toISOString(), kind, inputTokens, outputTokens, model, ip);
  }

  // Which IPs have used one 订阅码 — the sharing / abuse check. A code used
  // from many addresses at once has probably been passed around.
  codeSources(code, limit = 20) {
    return this.db
      .prepare(
        `SELECT ip, COUNT(*) AS requests, MIN(ts) AS first_seen, MAX(ts) AS last_seen
         FROM usage_log WHERE code = ? AND ip <> ''
         GROUP BY ip ORDER BY requests DESC LIMIT ?`,
      )
      .all(code, limit);
  }

  usageSummary(code) {
    return this.db
      .prepare(
        `SELECT kind, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens,
                SUM(output_tokens) AS output_tokens
         FROM usage_log WHERE code = ? GROUP BY kind`,
      )
      .all(code);
  }

  // Aggregate stats for the admin dashboard. "Today"/"this month" use UTC
  // boundaries (usage_log.ts is ISO-UTC) — close enough for ops monitoring.
  overviewStats(now = new Date()) {
    const codes = this.db
      .prepare("SELECT COUNT(*) AS total, SUM(active) AS active FROM codes")
      .get();
    const since = (iso) =>
      this.db
        .prepare(
          `SELECT COUNT(*) AS requests,
                  COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
           FROM usage_log WHERE ts >= ?`,
        )
        .get(iso);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return {
      codesTotal: codes.total ?? 0,
      codesActive: codes.active ?? 0,
      today: since(dayStart.toISOString()),
      month: since(monthStart.toISOString()),
      allTime: since("1970-01-01T00:00:00.000Z"),
    };
  }

  recentUsage(limit = 50) {
    return this.db
      .prepare(
        `SELECT u.ts, u.kind, u.input_tokens, u.output_tokens, u.model, u.code, u.ip,
                COALESCE(c.label, '') AS label
         FROM usage_log u LEFT JOIN codes c ON c.code = u.code
         ORDER BY u.id DESC LIMIT ?`,
      )
      .all(limit);
  }

  close() {
    this.db.close();
  }
}
