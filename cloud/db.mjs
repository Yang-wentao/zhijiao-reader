// SQLite storage for activation codes + usage metering.
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
        model TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_code_ts ON usage_log(code, ts);
    `);
  }

  createCode({ label = "", quotaTokens }) {
    const code = generateCode();
    this.db
      .prepare(
        "INSERT INTO codes (code, label, quota_tokens, period, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(code, label, quotaTokens, currentPeriod(), new Date().toISOString());
    return this.getCode(code);
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

  recordUsage(code, { kind, inputTokens, outputTokens, model }, now = new Date()) {
    const total = inputTokens + outputTokens;
    this.db
      .prepare("UPDATE codes SET used_tokens = used_tokens + ? WHERE code = ?")
      .run(total, code);
    this.db
      .prepare(
        "INSERT INTO usage_log (code, ts, kind, input_tokens, output_tokens, model) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(code, now.toISOString(), kind, inputTokens, outputTokens, model);
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

  close() {
    this.db.close();
  }
}
